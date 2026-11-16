package com.inkandkin.lanchat.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.inkandkin.lanchat.model.ConnectionState
import com.inkandkin.lanchat.model.MobileMessageDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

sealed interface WsDownstreamEvent {
    data object Connected : WsDownstreamEvent
    data object ReconnectedSyncNeeded : WsDownstreamEvent
    data class Typing(val personaId: Int, val isTyping: Boolean) : WsDownstreamEvent
    data class Bubble(
        val personaId: Int,
        val turnId: String?,
        val message: MobileMessageDto
    ) : WsDownstreamEvent

    data class Recall(
        val personaId: Int,
        val turnId: String?,
        val messageIds: List<Long>
    ) : WsDownstreamEvent

    data class Proactive(
        val personaId: Int,
        val message: MobileMessageDto
    ) : WsDownstreamEvent

    data class SceneState(
        val personaId: Int,
        val activeSceneId: Int?,
        val activeSceneTitle: String?
    ) : WsDownstreamEvent
}

class LanRealtimeHub(
    context: Context,
    private val sessionStore: SessionStore,
    private val apiClient: InkAndKinApiClient
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val connectivityManager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private class SessionEvent(val session: MobileSession, val event: WsDownstreamEvent)

    private val _events = MutableSharedFlow<SessionEvent>(extraBufferCapacity = 128)
    val events: Flow<WsDownstreamEvent> = _events
        .filter { sessionStore.isCurrent(it.session) }
        .map { it.event }

    private fun publish(session: MobileSession, event: WsDownstreamEvent) {
        _events.tryEmit(SessionEvent(session, event))
    }

    @Volatile
    private var webSocket: WebSocket? = null

    @Volatile
    private var activeWsUrl: String = ""
    private var activeSession: MobileSession? = null

    private var reconnectJob: Job? = null
    private var pingJob: Job? = null
    private var reconnectAttempts: Int = 0
    private var shouldStayConnected: Boolean = false
    private val lastTypingSentAt = HashMap<Int, Long>()

    init {
        registerNetworkCallback()
    }

    @Synchronized
    fun ensureConnected(forceReconnect: Boolean = false) {
        val session = sessionStore.snapshot()
        if (session == null) {
            disconnect()
            return
        }
        shouldStayConnected = true
        val targetWsUrl = UrlResolver.buildWebSocketUrl(session.baseUrl)
        if (!forceReconnect && webSocket != null && activeWsUrl == targetWsUrl && activeSession?.token == session.token &&
            (_connectionState.value == ConnectionState.CONNECTED || _connectionState.value == ConnectionState.CONNECTING)
        ) {
            return
        }
        reconnectJob?.cancel()
        openSocketInternal(targetWsUrl, session)
    }

    @Synchronized
    fun disconnect(markExpired: Boolean = false) {
        shouldStayConnected = false
        reconnectJob?.cancel()
        pingJob?.cancel()
        val old = webSocket
        webSocket = null
        activeWsUrl = ""
        activeSession = null
        lastTypingSentAt.clear()
        runCatching { old?.close(1000, "Client disconnect") }
        _connectionState.value = if (markExpired) {
            ConnectionState.AUTH_EXPIRED
        } else {
            ConnectionState.DISCONNECTED
        }
    }

    fun sendUserTyping(personaId: Int) {
        val now = System.currentTimeMillis()
        val prev = lastTypingSentAt[personaId] ?: 0L
        if (now - prev < 2200L) return
        lastTypingSentAt[personaId] = now
        val payload = buildJsonObject {
            put("type", "user_typing")
            put("personaId", personaId)
        }
        runCatching { webSocket?.send(payload.toString()) }
    }

    fun sendStopTurn(personaId: Int): Boolean {
        val payload = buildJsonObject {
            put("type", "stop_turn")
            put("personaId", personaId)
        }
        return runCatching { webSocket?.send(payload.toString()) ?: false }.getOrDefault(false)
    }

    @Synchronized
    private fun openSocketInternal(wsUrl: String, session: MobileSession) {
        pingJob?.cancel()
        val prev = webSocket
        webSocket = null
        runCatching { prev?.cancel() }

        activeWsUrl = wsUrl
        activeSession = session
        _connectionState.value = ConnectionState.CONNECTING

        val request = Request.Builder()
            .url(wsUrl)
            .header("Authorization", "Bearer ${session.token}")
            .build()

        val ws = apiClient.okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (this@LanRealtimeHub.webSocket !== webSocket || !sessionStore.isCurrent(session)) return
                reconnectAttempts = 0
                _connectionState.value = ConnectionState.CONNECTED
                startPingLoop(webSocket)
                publish(session, WsDownstreamEvent.Connected)
                publish(session, WsDownstreamEvent.ReconnectedSyncNeeded)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (this@LanRealtimeHub.webSocket !== webSocket || !sessionStore.isCurrent(session)) return
                handleIncomingJson(text, session)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                runCatching { webSocket.close(code, reason) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (this@LanRealtimeHub.webSocket !== webSocket || !sessionStore.isCurrent(session)) return
                this@LanRealtimeHub.webSocket = null
                pingJob?.cancel()
                if (code == 4001 || code == 4003 || code == 1008) {
                    disconnect(markExpired = true)
                } else if (shouldStayConnected) {
                    _connectionState.value = ConnectionState.DISCONNECTED
                    scheduleReconnect()
                } else {
                    _connectionState.value = ConnectionState.DISCONNECTED
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (this@LanRealtimeHub.webSocket !== webSocket || !sessionStore.isCurrent(session)) return
                this@LanRealtimeHub.webSocket = null
                pingJob?.cancel()
                if (response?.code == 401 || response?.code == 403) {
                    disconnect(markExpired = true)
                    return
                }
                _connectionState.value = ConnectionState.DISCONNECTED
                if (shouldStayConnected) {
                    scheduleReconnect()
                }
            }
        })
        this.webSocket = ws
    }

    private fun startPingLoop(targetWs: WebSocket) {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (isActive && webSocket === targetWs) {
                delay(25_000L)
                if (webSocket === targetWs) {
                    val pingMsg = buildJsonObject {
                        put("type", "ping")
                        put("ts", System.currentTimeMillis())
                    }
                    runCatching { targetWs.send(pingMsg.toString()) }
                }
            }
        }
    }

    private fun scheduleReconnect() {
        if (!shouldStayConnected || !sessionStore.isAuthenticated) return
        reconnectJob?.cancel()
        val attempt = reconnectAttempts.coerceAtMost(5)
        reconnectAttempts++
        val delayMs = (1200L * (1 shl attempt)).coerceAtMost(15_000L)
        reconnectJob = scope.launch {
            delay(delayMs)
            if (shouldStayConnected && sessionStore.isAuthenticated) {
                ensureConnected(forceReconnect = true)
            }
        }
    }

    private fun handleIncomingJson(raw: String, session: MobileSession) {
        runCatching {
            val root = apiClient.json.parseToJsonElement(raw) as? JsonObject ?: return
            val payloadObj = (root["data"] as? JsonObject) ?: (root["payload"] as? JsonObject) ?: root
            val eventType = (root["type"] as? JsonPrimitive)?.contentOrNull
                ?: (root["event"] as? JsonPrimitive)?.contentOrNull
                ?: return

            when (eventType.lowercase()) {
                "connected" -> {
                    _connectionState.value = ConnectionState.CONNECTED
                    publish(session, WsDownstreamEvent.Connected)
                }

                "pong" -> {
                    // 心跳正常
                }

                "typing" -> {
                    val personaId = (payloadObj["personaId"] as? JsonPrimitive)?.intOrNull ?: return
                    val isTyping = (payloadObj["isTyping"] as? JsonPrimitive)?.booleanOrNull ?: false
                    publish(session, WsDownstreamEvent.Typing(personaId, isTyping))
                }

                "bubble" -> {
                    val msgEl = payloadObj["message"] ?: return
                    val msg = apiClient.json.decodeFromJsonElement<MobileMessageDto>(msgEl)
                    val personaId = (payloadObj["personaId"] as? JsonPrimitive)?.intOrNull ?: msg.personaId
                    val turnId = (payloadObj["turnId"] as? JsonPrimitive)?.contentOrNull ?: msg.turnId
                    publish(
                        session,
                        WsDownstreamEvent.Bubble(
                            personaId = personaId,
                            turnId = turnId,
                            message = if (msg.personaId == 0) msg.copy(personaId = personaId) else msg
                        )
                    )
                }

                "recall" -> {
                    val personaId = (payloadObj["personaId"] as? JsonPrimitive)?.intOrNull ?: return
                    val turnId = (payloadObj["turnId"] as? JsonPrimitive)?.contentOrNull
                    val ids = (payloadObj["messageIds"] as? JsonArray)?.mapNotNull { el ->
                        (el as? JsonPrimitive)?.longOrNull
                            ?: (el as? JsonPrimitive)?.contentOrNull?.toLongOrNull()
                    }.orEmpty()
                    if (ids.isNotEmpty()) {
                        publish(session, WsDownstreamEvent.Recall(personaId, turnId, ids))
                    }
                }

                "proactive" -> {
                    val msgEl = payloadObj["message"] ?: return
                    val msg = apiClient.json.decodeFromJsonElement<MobileMessageDto>(msgEl)
                    val personaId = (payloadObj["personaId"] as? JsonPrimitive)?.intOrNull ?: msg.personaId
                    publish(
                        session,
                        WsDownstreamEvent.Proactive(
                            personaId = personaId,
                            message = if (msg.personaId == 0) msg.copy(personaId = personaId) else msg
                        )
                    )
                }

                "scene_state" -> {
                    val personaId = (payloadObj["personaId"] as? JsonPrimitive)?.intOrNull ?: return
                    val activeSceneId = (payloadObj["activeSceneId"] as? JsonPrimitive)?.intOrNull
                    val activeSceneTitle = (payloadObj["activeSceneTitle"] as? JsonPrimitive)?.contentOrNull
                    publish(
                        session,
                        WsDownstreamEvent.SceneState(
                            personaId = personaId,
                            activeSceneId = activeSceneId,
                            activeSceneTitle = activeSceneTitle
                        )
                    )
                }
            }
        }
    }

    private fun registerNetworkCallback() {
        val cm = connectivityManager ?: return
        runCatching {
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            cm.registerNetworkCallback(req, object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    if (shouldStayConnected && sessionStore.isAuthenticated &&
                        _connectionState.value != ConnectionState.CONNECTED
                    ) {
                        reconnectAttempts = 0
                        ensureConnected(forceReconnect = true)
                    }
                }
            })
        }
    }
}
