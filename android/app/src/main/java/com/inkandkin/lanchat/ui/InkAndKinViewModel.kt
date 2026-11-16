package com.inkandkin.lanchat.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.inkandkin.lanchat.BuildConfig
import com.inkandkin.lanchat.InkAndKinApp
import com.inkandkin.lanchat.data.AuthExpiredException
import com.inkandkin.lanchat.data.PairDeepLinkPayload
import com.inkandkin.lanchat.data.SavedServer
import com.inkandkin.lanchat.data.SessionStore
import com.inkandkin.lanchat.data.appLabel
import com.inkandkin.lanchat.data.UrlResolver
import com.inkandkin.lanchat.data.WsDownstreamEvent
import com.inkandkin.lanchat.media.ImageCompressor
import com.inkandkin.lanchat.media.RecordedVoicePayload
import com.inkandkin.lanchat.model.ChatMessageItem
import com.inkandkin.lanchat.model.ConnectionState
import com.inkandkin.lanchat.model.DiscoveredServer
import com.inkandkin.lanchat.model.MobileMessageDto
import com.inkandkin.lanchat.model.MobileServerKind
import com.inkandkin.lanchat.model.MobileUserDto
import com.inkandkin.lanchat.model.MobileVersionDto
import com.inkandkin.lanchat.model.PersonaSummaryDto
import com.inkandkin.lanchat.model.ProactiveTargetMode
import com.inkandkin.lanchat.model.RetryPayload
import com.inkandkin.lanchat.model.ScenesResponseDto
import com.inkandkin.lanchat.model.SendStatus
import com.inkandkin.lanchat.service.LanConnectionService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException
import java.net.SocketTimeoutException
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

data class InAppBanner(
    val personaId: Int,
    val personaName: String,
    val preview: String
)

data class InkAndKinUiState(
    val isAuthenticated: Boolean = false,
    val baseUrl: String = "",
    val pairInputUrl: String = "",
    val pairInputCode: String = "",
    val pairInputKind: MobileServerKind? = null,
    val serverKind: MobileServerKind? = null,
    val sessionActivation: Long = 0L,
    val savedServers: List<SavedServer> = emptyList(),
    val user: MobileUserDto? = null,
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val discoveredServers: List<DiscoveredServer> = emptyList(),
    val isScanningLan: Boolean = false,
    val manualPingMs: Long? = null,
    val isPingingManual: Boolean = false,
    val isPairingBusy: Boolean = false,
    val pairingHint: String? = null,
    val personas: List<PersonaSummaryDto> = emptyList(),
    val isLoadingPersonas: Boolean = false,
    val activePersonaId: Int? = null,
    val messagesByPersona: Map<Int, List<ChatMessageItem>> = emptyMap(),
    val hasMoreByPersona: Map<Int, Boolean> = emptyMap(),
    val loadingMessagesPersonaId: Int? = null,
    val loadingOlderPersonaId: Int? = null,
    val typingByPersona: Map<Int, Boolean> = emptyMap(),
    val activeSceneIdByPersona: Map<Int, Int?> = emptyMap(),
    val activeSceneTitleByPersona: Map<Int, String?> = emptyMap(),
    val scenesState: ScenesResponseDto? = null,
    val isLoadingScenes: Boolean = false,
    val replyingToMessage: MobileMessageDto? = null,
    val inAppBanner: InAppBanner? = null,
    val proactiveMode: ProactiveTargetMode = ProactiveTargetMode.MOBILE_FIRST,
    val isSavingProactiveMode: Boolean = false,
    val keepAliveEnabled: Boolean = true,
    val autoPlayVoice: Boolean = true,
    val versionInfo: MobileVersionDto? = null,
    val isCheckingVersion: Boolean = false
) {
    val activePersona: PersonaSummaryDto?
        get() = personas.firstOrNull { it.id == activePersonaId }
}

class InkAndKinViewModel(application: Application) : AndroidViewModel(application) {

    private val app: InkAndKinApp = application as InkAndKinApp
    private val sessionStore = app.sessionStore
    private val apiClient = app.apiClient
    private val discoveryClient = app.discoveryClient
    private val realtimeHub = app.realtimeHub
    val voicePlayer = app.voicePlayerManager

    private val tempIdGenerator = AtomicLong(-System.currentTimeMillis())
    private val typingTimeoutJobs = HashMap<Int, Job>()
    private val historyVersions = HashMap<Int, Int>()
    private val sessionWork = CoroutineScope(viewModelScope.coroutineContext + SupervisorJob(viewModelScope.coroutineContext[Job]))
    private var coldStartAutoEntered = false

    private val _uiState = MutableStateFlow(createInitialState())
    val uiState: StateFlow<InkAndKinUiState> = _uiState.asStateFlow()

    private val _toastEvents = MutableSharedFlow<String>(extraBufferCapacity = 16)
    val toastEvents: SharedFlow<String> = _toastEvents.asSharedFlow()

    init {
        // 同步实时连接状态
        viewModelScope.launch {
            realtimeHub.connectionState.collect { conn ->
                _uiState.update { it.copy(connectionState = conn) }
                if (conn == ConnectionState.AUTH_EXPIRED && conn == realtimeHub.connectionState.value && _uiState.value.isAuthenticated) {
                    handleAuthExpired("配对已失效，请重新验证")
                }
            }
        }

        // 订阅 WebSocket 下行实时事件
        viewModelScope.launch {
            realtimeHub.events.collect { event ->
                handleWsEvent(event)
            }
        }

        // 冷启动流程
        if (sessionStore.isAuthenticated) {
            val currentPersonaId = _uiState.value.activePersonaId
            refreshPersonas(allowAutoEnter = currentPersonaId == null)
            if (currentPersonaId != null) {
                loadInitialOrSyncMessages(currentPersonaId)
            }
            loadRemoteSettingsSilently()
        } else {
            scanLanServers()
        }
    }

    private fun createInitialState(): InkAndKinUiState {
        val authed = sessionStore.isAuthenticated
        val savedUrl = sessionStore.baseUrl
        val cachedPersonas = if (authed) sessionStore.loadCachedPersonas() else emptyList()
        val lastId = sessionStore.lastSelectedPersonaId
        val initialPersonaId = if (authed) {
            when {
                lastId != null && (cachedPersonas.isEmpty() || cachedPersonas.any { it.id == lastId }) -> lastId
                cachedPersonas.size == 1 -> cachedPersonas.first().id
                else -> null
            }
        } else {
            null
        }
        if (initialPersonaId != null) {
            coldStartAutoEntered = true
        }

        val initialMessagesMap = HashMap<Int, List<ChatMessageItem>>()
        val sceneIdMap = HashMap<Int, Int?>()
        val sceneTitleMap = HashMap<Int, String?>()

        cachedPersonas.forEach { p ->
            sceneIdMap[p.id] = p.activeSceneId
            sceneTitleMap[p.id] = p.activeSceneTitle
        }

        if (initialPersonaId != null) {
            val cachedMsgs = sessionStore.loadCachedMessages(initialPersonaId)
            if (cachedMsgs.isNotEmpty()) {
                initialMessagesMap[initialPersonaId] = cachedMsgs.map { ChatMessageItem(dto = it) }
            }
        }

        return InkAndKinUiState(
            isAuthenticated = authed,
            baseUrl = savedUrl,
            pairInputUrl = savedUrl,
            user = sessionStore.user,
            serverKind = sessionStore.snapshot()?.kind,
            sessionActivation = sessionStore.snapshot()?.activation ?: 0L,
            savedServers = sessionStore.savedServers(),
            connectionState = realtimeHub.connectionState.value,
            personas = cachedPersonas,
            activePersonaId = initialPersonaId,
            messagesByPersona = initialMessagesMap,
            activeSceneIdByPersona = sceneIdMap,
            activeSceneTitleByPersona = sceneTitleMap,
            keepAliveEnabled = sessionStore.keepAliveEnabled,
            autoPlayVoice = sessionStore.autoPlayVoice
        )
    }

    fun updatePairInputUrl(url: String) {
        if (_uiState.value.isPairingBusy) return
        val deepLink = UrlResolver.parsePairDeepLink(url)
        if (deepLink != null) {
            handlePairDeepLink(deepLink)
            return
        }
        _uiState.update {
            val sameAddress = UrlResolver.normalizeBaseUrl(url) == UrlResolver.normalizeBaseUrl(it.pairInputUrl)
            it.copy(pairInputUrl = url, pairInputKind = if (sameAddress) it.pairInputKind else null,
                pairInputCode = if (sameAddress) it.pairInputCode else "", manualPingMs = null, pairingHint = null)
        }
    }

    fun updatePairInputCode(code: String) {
        val filtered = code.filter { it.isDigit() || it.isLetter() }.take(12)
        _uiState.update { it.copy(pairInputCode = filtered, pairingHint = null) }
    }

    fun handlePairDeepLink(payload: PairDeepLinkPayload) {
        if (_uiState.value.isPairingBusy) return
        if (_uiState.value.isAuthenticated) showPairing()
        _uiState.update {
            it.copy(
                pairInputUrl = payload.serverUrl,
                pairInputCode = payload.code,
                pairInputKind = payload.kind,
                manualPingMs = null,
                pairingHint = "请确认这是你信任的${payload.kind.appLabel}服务器，再选择配对。"
            )
        }
    }

    fun openPersonaFromNotification(personaId: Int) {
        if (!_uiState.value.isAuthenticated || personaId <= 0) return
        openPersonaChat(personaId)
    }

    fun dismissInAppBanner() {
        _uiState.update { it.copy(inAppBanner = null) }
    }

    /**
     * 扫描支持的两种局域网服务。
     */
    fun scanLanServers() {
        if (_uiState.value.isScanningLan) return
        viewModelScope.launch {
            _uiState.update { it.copy(isScanningLan = true) }
            val extras = buildList {
                sessionStore.savedServers().forEach { add(it.baseUrl) }
                if (sessionStore.baseUrl.isNotBlank()) add(sessionStore.baseUrl)
                if (_uiState.value.pairInputUrl.isNotBlank()) add(_uiState.value.pairInputUrl)
            }
            val list = discoveryClient.discoverServers(extras)
            val bestReachable = list.firstOrNull { it.reachable }
            _uiState.update { state ->
                val suggested = bestReachable?.takeIf { state.pairInputUrl.isBlank() && !state.isPairingBusy }
                state.copy(
                    isScanningLan = false,
                    discoveredServers = list,
                    pairInputUrl = suggested?.baseUrl ?: state.pairInputUrl,
                    pairInputKind = suggested?.kind ?: state.pairInputKind,
                    manualPingMs = suggested?.latencyMs ?: state.manualPingMs
                )
            }
        }
    }

    fun selectDiscoveredServer(server: DiscoveredServer) = switchServerAtAddress(server.baseUrl, server.kind)

    fun selectSavedServer(server: SavedServer) = switchServerAtAddress(server.baseUrl, server.kind)

    fun openServerPicker() {
        if (!_uiState.value.isPairingBusy) showPairing()
    }

    fun switchServerAtAddress(rawUrl: String, expectedKind: MobileServerKind? = null) {
        if (_uiState.value.isPairingBusy) return
        val url = UrlResolver.normalizeBaseUrl(rawUrl)
        if (url.isBlank()) {
            emitToast("请输入服务器地址。")
            return
        }
        _uiState.update { it.copy(isPairingBusy = true) }
        viewModelScope.launch {
            try {
                val probe = apiClient.probe(url) ?: throw IOException("该服务器暂时不可达，请确认手机所在网络。")
                if (expectedKind != null && probe.kind != expectedKind) {
                    throw IOException("该地址当前连接到${probe.kind.appLabel}，请核对服务器。")
                }
                val active = sessionStore.snapshot()
                if (active?.baseUrl == url && active.kind == probe.kind) return@launch
                val stored = sessionStore.savedServers().firstOrNull { it.baseUrl == url && it.kind == probe.kind }
                if (stored != null) {
                    stopSessionWork()
                    check(sessionStore.selectServer(stored))
                    onSessionActivated()
                } else {
                    showPairing(url, probe.kind, "请用${probe.kind.appLabel}的配对码或账号登录。")
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                emitToast(error.message ?: "切换服务器失败。")
            } finally {
                _uiState.update { it.copy(isPairingBusy = false) }
            }
        }
    }

    fun pingManualUrl(rawUrl: String = _uiState.value.pairInputUrl) {
        if (_uiState.value.isPairingBusy || _uiState.value.isPingingManual) return
        val normalized = UrlResolver.normalizeBaseUrl(rawUrl)
        if (normalized.isBlank()) {
            emitToast("请先输入台式机局域网地址")
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isPingingManual = true, pairInputUrl = normalized, manualPingMs = null) }
            val probe = apiClient.probe(normalized)
            _uiState.update { current ->
                if (UrlResolver.normalizeBaseUrl(current.pairInputUrl) != normalized) current.copy(isPingingManual = false)
                else current.copy(isPingingManual = false, manualPingMs = probe?.latencyMs)
            }
            if (probe != null) {
                emitToast("${probe.kind.appLabel} · ${probe.latencyMs} ms")
            } else {
                emitToast("无法连通 $normalized，请确认手机与台式机在同一局域网")
            }
        }
    }

    /**
     * 6 位配对码交换绑定
     */
    fun pairWithCode(
        rawUrl: String = _uiState.value.pairInputUrl,
        rawCode: String = _uiState.value.pairInputCode
    ) {
        val cleanUrl = UrlResolver.normalizeBaseUrl(rawUrl)
        val cleanCode = rawCode.trim()
        if (cleanUrl.isBlank()) {
            emitToast("请先选择或输入台式机地址")
            return
        }
        if (!cleanCode.matches(Regex("[0-9]{6}"))) {
            emitToast("请输入台式机设置页显示的 6 位配对码")
            return
        }
        if (_uiState.value.isPairingBusy || _uiState.value.isAuthenticated) return

        val expectedKind = _uiState.value.pairInputKind
        _uiState.update { it.copy(isPairingBusy = true, pairingHint = "正在验证配对码…") }
        viewModelScope.launch {
            try {
                val kind = verifyPairingServer(cleanUrl, expectedKind)
                val res = apiClient.pairExchange(
                    serverUrl = cleanUrl,
                    code = cleanCode,
                    deviceName = SessionStore.buildDeviceName(),
                    expectedKind = kind
                )
                onAuthenticationSuccess(cleanUrl, res.token, res.deviceId, res.user, kind)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                val msg = e.message ?: "配对失败，请检查配对码与网络连接"
                _uiState.update { it.copy(isPairingBusy = false, pairingHint = msg) }
                emitToast(msg)
            }
        }
    }

    /**
     * 账号密码直接登录
     */
    fun loginWithPassword(rawUrl: String, username: String, password: String) {
        val cleanUrl = UrlResolver.normalizeBaseUrl(rawUrl)
        if (cleanUrl.isBlank()) {
            emitToast("请先选择或输入台式机地址")
            return
        }
        if (username.isBlank() || password.isBlank()) {
            emitToast("请输入账号与密码")
            return
        }
        if (_uiState.value.isPairingBusy || _uiState.value.isAuthenticated) return

        val expectedKind = _uiState.value.pairInputKind
        _uiState.update { it.copy(isPairingBusy = true, pairingHint = "正在验证账号…") }
        viewModelScope.launch {
            try {
                val kind = verifyPairingServer(cleanUrl, expectedKind)
                val res = apiClient.loginWithPassword(
                    serverUrl = cleanUrl,
                    username = username,
                    password = password,
                    deviceName = SessionStore.buildDeviceName(),
                    expectedKind = kind
                )
                onAuthenticationSuccess(cleanUrl, res.token, res.deviceId, res.user, kind)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                val msg = e.message ?: "登录失败，请检查用户名与密码"
                _uiState.update { it.copy(isPairingBusy = false, pairingHint = msg) }
                emitToast(msg)
            }
        }
    }

    private suspend fun verifyPairingServer(url: String, expected: MobileServerKind?): MobileServerKind {
        val kind = apiClient.probe(url)?.kind ?: throw IOException("该地址未返回书中人或 Mirrai 的服务标识。")
        if (expected != null && expected != kind) {
            throw IOException("该地址返回${kind.appLabel}，请确认配对码和服务器匹配。")
        }
        return kind
    }

    private fun onAuthenticationSuccess(
        url: String,
        token: String,
        deviceId: String,
        user: MobileUserDto?,
        kind: MobileServerKind
    ) {
        sessionStore.saveSession(url, token, deviceId, user, kind)
        onSessionActivated()
    }

    private fun onSessionActivated() {
        coldStartAutoEntered = false
        val discovered = _uiState.value.discoveredServers
        _uiState.value = createInitialState().copy(discoveredServers = discovered, isScanningLan = _uiState.value.isScanningLan)
        if (app.isInForeground.value) realtimeHub.ensureConnected(forceReconnect = true)
        LanConnectionService.syncServiceState(app)
        refreshPersonas(allowAutoEnter = true)
        loadRemoteSettingsSilently()
    }

    fun logoutAndUnpair() {
        val session = sessionStore.snapshot()
        val deviceId = sessionStore.deviceId
        showPairing(forgetCurrent = true)
        if (session != null) viewModelScope.launch {
            val revoked = try {
                apiClient.revokeDeviceSession(session, session.kind, deviceId)
            } catch (_: IOException) {
                false
            }
            if (!revoked) emitToast("本机已退出。可在${session.kind.appLabel}网页上撤销该设备。")
        }
    }

    private fun handleAuthExpired(reason: String) {
        showPairing(sessionStore.baseUrl, sessionStore.snapshot()?.kind, reason, forgetCurrent = true)
        emitToast(reason)
    }

    private fun stopSessionWork() {
        sessionWork.coroutineContext.cancelChildren()
        typingTimeoutJobs.clear()
        historyVersions.clear()
        voicePlayer.stopAll()
        realtimeHub.disconnect()
        apiClient.cancelPendingRequests()
        app.clearSessionNotifications()
    }

    private fun showPairing(
        nextUrl: String = "", kind: MobileServerKind? = null, hint: String? = null, forgetCurrent: Boolean = false
    ) {
        stopSessionWork()
        sessionStore.switchToPairing(nextUrl, forgetCurrent)
        LanConnectionService.syncServiceState(app)
        _uiState.value = createInitialState().copy(
            pairInputKind = kind, pairingHint = hint, discoveredServers = _uiState.value.discoveredServers,
            isScanningLan = _uiState.value.isScanningLan
        )
        scanLanServers()
    }

    fun refreshPersonas(allowAutoEnter: Boolean = false) {
        if (!sessionStore.isAuthenticated) return
        sessionWork.launch {
            _uiState.update { it.copy(isLoadingPersonas = true) }
            try {
                val list = apiClient.getPersonas()
                sessionStore.saveCachedPersonas(list)

                _uiState.update { state ->
                    val nextSceneIds = state.activeSceneIdByPersona.toMutableMap()
                    val nextSceneTitles = state.activeSceneTitleByPersona.toMutableMap()
                    list.forEach { p ->
                        nextSceneIds[p.id] = p.activeSceneId
                        nextSceneTitles[p.id] = p.activeSceneTitle
                    }

                    var targetPersonaId = state.activePersonaId
                    if (allowAutoEnter && !coldStartAutoEntered && targetPersonaId == null && list.isNotEmpty()) {
                        val savedLast = sessionStore.lastSelectedPersonaId
                        targetPersonaId = when {
                            list.size == 1 -> list.first().id
                            savedLast != null && list.any { it.id == savedLast } -> savedLast
                            else -> null
                        }
                        if (targetPersonaId != null) {
                            coldStartAutoEntered = true
                            sessionStore.lastSelectedPersonaId = targetPersonaId
                        }
                    }

                    state.copy(
                        isLoadingPersonas = false,
                        personas = list,
                        activePersonaId = targetPersonaId,
                        activeSceneIdByPersona = nextSceneIds,
                        activeSceneTitleByPersona = nextSceneTitles,
                    )
                }

                val openedId = _uiState.value.activePersonaId
                if (openedId != null && _uiState.value.messagesByPersona[openedId].isNullOrEmpty()) {
                    loadInitialOrSyncMessages(openedId)
                }
            } catch (e: AuthExpiredException) {
                handleAuthExpired(e.message ?: "凭证已失效")
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                _uiState.update { it.copy(isLoadingPersonas = false) }
            }
        }
    }

    fun openPersonaChat(personaId: Int) {
        coldStartAutoEntered = true
        sessionStore.lastSelectedPersonaId = personaId
        val cached = _uiState.value.messagesByPersona[personaId]
            ?: sessionStore.loadCachedMessages(personaId).map { ChatMessageItem(dto = it) }

        _uiState.update { state ->
            val updatedMap = state.messagesByPersona.toMutableMap()
            if (cached.isNotEmpty() && updatedMap[personaId].isNullOrEmpty()) {
                updatedMap[personaId] = cached
            }
            state.copy(
                activePersonaId = personaId,
                messagesByPersona = updatedMap,
                replyingToMessage = null,
                inAppBanner = if (state.inAppBanner?.personaId == personaId) null else state.inAppBanner
            )
        }
        loadInitialOrSyncMessages(personaId)
    }

    fun navigateBackToPersonaList() {
        voicePlayer.stopAll()
        sessionStore.lastSelectedPersonaId = null
        _uiState.update { it.copy(activePersonaId = null, replyingToMessage = null) }
        refreshPersonas(allowAutoEnter = false)
    }

    fun loadInitialOrSyncMessages(personaId: Int) {
        if (!sessionStore.isAuthenticated) return
        val version = historyVersions[personaId]

        sessionWork.launch {
            _uiState.update { it.copy(loadingMessagesPersonaId = personaId) }
            try {
                val page = apiClient.getMessages(personaId = personaId, limit = 50, scope = "current")
                if (version != historyVersions[personaId]) return@launch
                val sortedServer = page.messages.sortedBy { it.id }
                sessionStore.saveCachedMessages(personaId, sortedServer)

                _uiState.update { state ->
                    val currentItems = state.messagesByPersona[personaId].orEmpty()
                    val pendingOptimistic = if (state.activeSceneIdByPersona[personaId] == page.activeSceneId) {
                        currentItems.filter { it.dto.id < 0L }
                    } else emptyList()
                    var merged = sortedServer.map { ChatMessageItem(dto = it) }
                    pendingOptimistic.forEach { opt ->
                        val matched = sortedServer.any { srv ->
                            srv.isUser && isOptimisticMatch(opt, srv)
                        }
                        if (!matched) {
                            merged = merged + opt
                        }
                    }
                    val map = state.messagesByPersona.toMutableMap()
                    map[personaId] = enrichQuotedSummaries(merged)

                    val hasMoreMap = state.hasMoreByPersona.toMutableMap()
                    hasMoreMap[personaId] = page.hasMore

                    val sceneIdMap = state.activeSceneIdByPersona.toMutableMap()
                    val sceneTitleMap = state.activeSceneTitleByPersona.toMutableMap()
                    sceneIdMap[personaId] = page.activeSceneId
                    sceneTitleMap[personaId] = page.activeSceneTitle


                    state.copy(
                        loadingMessagesPersonaId = if (state.loadingMessagesPersonaId == personaId) null else state.loadingMessagesPersonaId,
                        messagesByPersona = map,
                        hasMoreByPersona = hasMoreMap,
                        activeSceneIdByPersona = sceneIdMap,
                        activeSceneTitleByPersona = sceneTitleMap,
                    )
                }
            } catch (e: AuthExpiredException) {
                handleAuthExpired(e.message ?: "凭证已过期")
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                _uiState.update {
                    if (it.loadingMessagesPersonaId == personaId) it.copy(loadingMessagesPersonaId = null) else it
                }
            }
        }
    }

    fun loadOlderMessages(personaId: Int) {
        val state = _uiState.value
        val version = historyVersions[personaId]
        if (state.loadingOlderPersonaId == personaId) return
        if (state.hasMoreByPersona[personaId] != true) return
        val oldestId = state.messagesByPersona[personaId]
            ?.map { it.dto.id }
            ?.filter { it > 0L }
            ?.minOrNull() ?: return

        sessionWork.launch {
            _uiState.update { it.copy(loadingOlderPersonaId = personaId) }
            try {
                val page = apiClient.getMessages(
                    personaId = personaId,
                    limit = 40,
                    beforeId = oldestId,
                    scope = "current"
                )
                if (version != historyVersions[personaId]) return@launch
                if (page.activeSceneId != _uiState.value.activeSceneIdByPersona[personaId]) {
                    clearPersonaHistory(personaId)
                    loadInitialOrSyncMessages(personaId)
                    return@launch
                }
                val olderItems = page.messages.sortedBy { it.id }.map { ChatMessageItem(dto = it) }
                _uiState.update { cur ->
                    val existing = cur.messagesByPersona[personaId].orEmpty()
                    val existingIds = existing.map { it.dto.id }.toHashSet()
                    val combined = olderItems.filter { it.dto.id !in existingIds } + existing
                    val nextMap = cur.messagesByPersona.toMutableMap()
                    nextMap[personaId] = enrichQuotedSummaries(combined)
                    val nextMore = cur.hasMoreByPersona.toMutableMap()
                    nextMore[personaId] = page.hasMore
                    cur.copy(
                        loadingOlderPersonaId = null,
                        messagesByPersona = nextMap,
                        hasMoreByPersona = nextMore
                    )
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                _uiState.update { it.copy(loadingOlderPersonaId = null) }
            }
        }
    }

    private fun syncIncrementalMessages(personaId: Int) {
        if (!sessionStore.isAuthenticated) return
        val version = historyVersions[personaId]
        val latestServerId = _uiState.value.messagesByPersona[personaId]
            ?.map { it.dto.id }
            ?.filter { it > 0L }
            ?.maxOrNull()

        if (latestServerId == null) {
            loadInitialOrSyncMessages(personaId)
            return
        }

        sessionWork.launch {
            runCatching {
                val page = apiClient.getMessages(
                    personaId = personaId,
                    limit = 50,
                    afterId = latestServerId,
                    scope = "current"
                )
                if (version != historyVersions[personaId]) return@runCatching
                if (page.activeSceneId != _uiState.value.activeSceneIdByPersona[personaId]) {
                    clearPersonaHistory(personaId)
                    loadInitialOrSyncMessages(personaId)
                    return@runCatching
                }
                if (page.messages.isNotEmpty()) {
                    page.messages.sortedBy { it.id }.forEach { msg ->
                        mergeServerMessage(personaId, msg, fromRealtime = false)
                    }
                }
                _uiState.update { state ->
                    val sceneIdMap = state.activeSceneIdByPersona.toMutableMap()
                    val sceneTitleMap = state.activeSceneTitleByPersona.toMutableMap()
                    sceneIdMap[personaId] = page.activeSceneId
                    sceneTitleMap[personaId] = page.activeSceneTitle
                    state.copy(
                        activeSceneIdByPersona = sceneIdMap,
                        activeSceneTitleByPersona = sceneTitleMap
                    )
                }
            }
        }
    }

    fun onUserInputTyping(personaId: Int) {
        realtimeHub.sendUserTyping(personaId)
    }

    fun setReplyTarget(message: MobileMessageDto?) {
        _uiState.update { it.copy(replyingToMessage = message) }
    }

    fun stopAssistantTurn(personaId: Int) {
        val sent = realtimeHub.sendStopTurn(personaId)
        setPersonaTyping(personaId, false)
        if (sent) {
            emitToast("已请求停止本轮回复")
        }
    }

    /**
     * 发送文本消息（支持乐观上屏 + 无重影去重合并 + 快捷指令如 "/p"）
     */
    fun sendText(personaId: Int, rawText: String) {
        val text = rawText.trim()
        if (text.isEmpty()) return

        val replyTarget = _uiState.value.replyingToMessage
        val replyId = replyTarget?.id?.takeIf { it > 0L }
        val quotedSummary = replyTarget?.let { buildQuoteSummary(it) }
        val clientMsgId = UUID.randomUUID().toString()
        val tempId = tempIdGenerator.decrementAndGet()

        val optimisticDto = MobileMessageDto(
            id = tempId,
            personaId = personaId,
            role = "user",
            content = text,
            messageType = "text",
            channel = "mobile",
            mode = if (_uiState.value.activeSceneIdByPersona[personaId] != null) "scene" else "daily",
            createdAt = Instant.now().toString(),
            clientMsgId = clientMsgId,
            replyToMessageId = replyId
        )

        val item = ChatMessageItem(
            dto = optimisticDto,
            sendStatus = SendStatus.SENDING,
            quotedSummary = quotedSummary,
            retryPayload = RetryPayload.Text(text, clientMsgId, replyId)
        )

        appendOptimisticItem(personaId, item)
        _uiState.update { it.copy(replyingToMessage = null) }
        updatePersonaPreview(personaId, text)

        executeSendText(personaId, tempId, text, clientMsgId, replyId)
    }

    private fun executeSendText(
        personaId: Int,
        tempId: Long,
        text: String,
        clientMsgId: String,
        replyToId: Long?
    ) = sendTurn(personaId, tempId) {
        apiClient.sendTextMessage(personaId, text, clientMsgId, replyToId)
    }

    private fun sendTurn(
        personaId: Int,
        tempId: Long,
        send: suspend () -> List<MobileMessageDto>
    ) {
        val version = historyVersions[personaId]
        sessionWork.launch {
            try {
                val messages = send()
                if (version != historyVersions[personaId]) return@launch
                if (messages.isEmpty()) {
                    markOptimisticSentOrSync(personaId, tempId)
                } else {
                    messages.forEach { message ->
                        mergeServerMessage(personaId, message, fromRealtime = false,
                            explicitTempId = if (message.isUser) tempId else null)
                    }
                }
            } catch (error: AuthExpiredException) {
                handleAuthExpired(error.message ?: "登录已失效")
            } catch (error: SocketTimeoutException) {
                if (version != historyVersions[personaId]) return@launch
                markOptimisticFailed(personaId, tempId)
                syncIncrementalMessages(personaId)
                emitToast("发送结果尚未确认，正在同步；可点原消息重试。")
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                markOptimisticFailed(personaId, tempId)
                emitToast(error.message ?: "消息发送失败，点击感叹号可重试。")
            }
        }
    }

    /**
     * 发送录制的语音消息
     */
    fun sendRecordedVoice(personaId: Int, recorded: RecordedVoicePayload) {
        val tempId = tempIdGenerator.decrementAndGet()
        val clientMsgId = UUID.randomUUID().toString()
        val reply = takeReplyTarget()
        val optimistic = MobileMessageDto(
            id = tempId,
            personaId = personaId,
            role = "user",
            content = "",
            messageType = "voice",
            mediaDuration = recorded.durationSeconds,
            channel = "mobile",
            mode = if (_uiState.value.activeSceneIdByPersona[personaId] != null) "scene" else "daily",
            createdAt = Instant.now().toString(),
            clientMsgId = clientMsgId,
            replyToMessageId = reply?.id
        )
        val payload = RetryPayload.Voice(recorded.audioBase64, recorded.durationSeconds, clientMsgId, reply?.id)
        appendOptimisticItem(personaId, ChatMessageItem(
            dto = optimistic,
            sendStatus = SendStatus.SENDING,
            quotedSummary = reply?.let(::buildQuoteSummary),
            retryPayload = payload
        ))
        updatePersonaPreview(personaId, "[语音 ${recorded.durationSeconds}″]")
        executeSendVoice(personaId, tempId, payload)
    }

    private fun takeReplyTarget(): MobileMessageDto? {
        val reply = _uiState.value.replyingToMessage?.takeIf { it.id > 0L }
        _uiState.update { it.copy(replyingToMessage = null) }
        return reply
    }

    private fun executeSendVoice(personaId: Int, tempId: Long, payload: RetryPayload.Voice) =
        sendTurn(personaId, tempId) {
            apiClient.sendVoiceMessage(personaId, payload.audioBase64, payload.durationSeconds,
                payload.clientMsgId, payload.replyToMessageId)
        }

    /**
     * 从相册选图压缩至 <=1600px JPEG Base64 并上传
     */
    fun sendPickedImage(personaId: Int, imageUri: Uri, caption: String? = null) {
        sessionWork.launch {
            val compressedResult = ImageCompressor.compressUriToJpegBase64(app, imageUri)
            val compressed = compressedResult.getOrElse { err ->
                emitToast(err.message ?: "图片处理失败")
                return@launch
            }

            val tempId = tempIdGenerator.decrementAndGet()
            val clientMsgId = UUID.randomUUID().toString()
            val reply = takeReplyTarget()
            val optimistic = MobileMessageDto(
                id = tempId,
                personaId = personaId,
                role = "user",
                content = caption.orEmpty(),
                messageType = "image",
                mediaUrl = compressed.localCacheUri,
                channel = "mobile",
                mode = if (_uiState.value.activeSceneIdByPersona[personaId] != null) "scene" else "daily",
                createdAt = Instant.now().toString(),
                clientMsgId = clientMsgId,
                replyToMessageId = reply?.id
            )
            val payload = RetryPayload.Image(compressed.imageBase64, compressed.mimeType, compressed.fileName,
                caption, clientMsgId, reply?.id)
            appendOptimisticItem(personaId, ChatMessageItem(
                dto = optimistic,
                sendStatus = SendStatus.SENDING,
                localPreviewUri = compressed.localCacheUri,
                quotedSummary = reply?.let(::buildQuoteSummary),
                retryPayload = payload
            ))
            updatePersonaPreview(personaId, "[图片]")
            executeSendImage(personaId, tempId, payload)
        }
    }

    private fun executeSendImage(personaId: Int, tempId: Long, payload: RetryPayload.Image) =
        sendTurn(personaId, tempId) {
            apiClient.sendImageMessage(personaId, payload.imageBase64, payload.mimeType, payload.fileName,
                payload.caption, payload.clientMsgId, payload.replyToMessageId)
        }

    fun retryFailedMessage(personaId: Int, item: ChatMessageItem) {
        val payload = item.retryPayload ?: return
        updateOptimisticStatus(personaId, item.id, SendStatus.SENDING)
        when (payload) {
            is RetryPayload.Text -> executeSendText(personaId, item.id, payload.text, payload.clientMsgId, payload.replyToMessageId)
            is RetryPayload.Voice -> executeSendVoice(personaId, item.id, payload)
            is RetryPayload.Image -> executeSendImage(personaId, item.id, payload)
        }
    }

    /**
     * 剧场场景获取与切换
     */
    fun loadScenes(personaId: Int) {
        sessionWork.launch {
            _uiState.update { it.copy(isLoadingScenes = true) }
            try {
                val resp = apiClient.getScenes(personaId)
                _uiState.update { state ->
                    val sId = state.activeSceneIdByPersona.toMutableMap().apply { put(personaId, resp.activeSceneId) }
                    val matchedTitle = resp.scenes.firstOrNull { it.id == resp.activeSceneId }?.title
                    val sTitle = state.activeSceneTitleByPersona.toMutableMap().apply {
                        if (resp.activeSceneId != null && matchedTitle != null) put(personaId, matchedTitle)
                        else if (resp.activeSceneId == null) put(personaId, null)
                    }
                    state.copy(
                        isLoadingScenes = false,
                        scenesState = resp,
                        activeSceneIdByPersona = sId,
                        activeSceneTitleByPersona = sTitle,
                    )
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                _uiState.update { it.copy(isLoadingScenes = false) }
                emitToast(e.message ?: "加载剧场列表失败")
            }
        }
    }

    fun switchScene(personaId: Int, sceneId: Int?, sceneTitle: String?) {
        sessionWork.launch {
            try {
                apiClient.updateScene(personaId, sceneId)
                if (_uiState.value.activeSceneIdByPersona[personaId] != sceneId) clearPersonaHistory(personaId)
                _uiState.update { state ->
                    val sId = state.activeSceneIdByPersona.toMutableMap().apply { put(personaId, sceneId) }
                    val sTitle = state.activeSceneTitleByPersona.toMutableMap().apply { put(personaId, sceneTitle) }
                    val updatedPersonas = state.personas.map { p ->
                        if (p.id == personaId) {
                            p.copy(
                                activeSceneId = sceneId,
                                activeSceneTitle = sceneTitle,
                            )
                        } else p
                    }
                    state.copy(
                        personas = updatedPersonas,
                        activeSceneIdByPersona = sId,
                        activeSceneTitleByPersona = sTitle,
                        scenesState = state.scenesState?.copy(
                            activeSceneId = sceneId,
                        )
                    )
                }
                val hint = when {
                    sceneId != null -> "已切入剧场「${sceneTitle ?: "场景"}」"
                    else -> "已切回轻快日常对话模式"
                }
                emitToast(hint)
                loadInitialOrSyncMessages(personaId)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                emitToast(e.message ?: "切换场景失败")
            }
        }
    }

    /**
     * 新开本段对话
     */
    fun resetConversationSegment(personaId: Int) {
        sessionWork.launch {
            try {
                voicePlayer.stopAll()
                apiClient.resetSegment(personaId)
                clearPersonaHistory(personaId)
                emitToast("已开启全新一段对话")
                loadInitialOrSyncMessages(personaId)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                emitToast(e.message ?: "新开本段失败")
            }
        }
    }

    private fun clearPersonaHistory(personaId: Int) {
        if (_uiState.value.activePersonaId == personaId) voicePlayer.stopAll()
        historyVersions[personaId] = (historyVersions[personaId] ?: 0) + 1
        sessionStore.saveCachedMessages(personaId, emptyList())
        _uiState.update { state ->
            state.copy(
                messagesByPersona = state.messagesByPersona - personaId,
                hasMoreByPersona = state.hasMoreByPersona - personaId,
                loadingMessagesPersonaId = state.loadingMessagesPersonaId?.takeUnless { it == personaId },
                loadingOlderPersonaId = state.loadingOlderPersonaId?.takeUnless { it == personaId },
                replyingToMessage = state.replyingToMessage?.takeUnless { it.personaId == personaId }
            )
        }
    }

    /**
     * 设置项读写与版本检查
     */
    fun loadRemoteSettingsSilently() {
        if (!sessionStore.isAuthenticated) return
        sessionWork.launch {
            runCatching {
                val settings = apiClient.getSettings()
                _uiState.update {
                    it.copy(proactiveMode = ProactiveTargetMode.fromWire(settings.proactiveTargetMode))
                }
            }
        }
    }

    fun updateProactiveTargetMode(mode: ProactiveTargetMode) {
        val previous = _uiState.value.proactiveMode
        _uiState.update { it.copy(proactiveMode = mode, isSavingProactiveMode = true) }
        sessionWork.launch {
            try {
                val saved = apiClient.updateSettings(mode.wireValue)
                _uiState.update {
                    it.copy(
                        proactiveMode = ProactiveTargetMode.fromWire(saved.proactiveTargetMode),
                        isSavingProactiveMode = false
                    )
                }
                emitToast("主动消息策略已更新为「${mode.title}」")
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                _uiState.update { it.copy(proactiveMode = previous, isSavingProactiveMode = false) }
                emitToast(e.message ?: "保存主动消息策略失败")
            }
        }
    }

    fun setKeepAliveEnabled(enabled: Boolean) {
        sessionStore.keepAliveEnabled = enabled
        _uiState.update { it.copy(keepAliveEnabled = enabled) }
        LanConnectionService.syncServiceState(app)
        emitToast(if (enabled) "已开启后台接收，将受系统运行时限约束" else "已关闭后台接收")
    }

    fun setAutoPlayVoice(enabled: Boolean) {
        sessionStore.autoPlayVoice = enabled
        _uiState.update { it.copy(autoPlayVoice = enabled) }
        if (!enabled) {
            voicePlayer.stopAll()
        }
    }

    fun checkAppVersion(showUpToDateToast: Boolean = true) {
        val session = sessionStore.snapshot() ?: return
        if (_uiState.value.isCheckingVersion || session.kind != MobileServerKind.INK_AND_KIN) return
        sessionWork.launch {
            _uiState.update { it.copy(isCheckingVersion = true) }
            try {
                val ver = apiClient.getVersion(session.kind)
                _uiState.update { it.copy(isCheckingVersion = false, versionInfo = ver) }
                if (!ver.available && showUpToDateToast) {
                    emitToast("当前服务器尚未提供 Android 安装包。")
                } else if (ver.available && ver.versionCode > BuildConfig.VERSION_CODE) {
                    emitToast("发现新版本 v${ver.versionName}，可点击立即下载更新")
                } else if (showUpToDateToast) {
                    emitToast("当前已是最新版本 v${BuildConfig.VERSION_NAME}")
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                _uiState.update { it.copy(isCheckingVersion = false) }
                if (showUpToDateToast) {
                    emitToast(e.message ?: "检查版本失败")
                }
            }
        }
    }

    private fun handleWsEvent(event: WsDownstreamEvent) {
        when (event) {
            WsDownstreamEvent.Connected -> Unit

            WsDownstreamEvent.ReconnectedSyncNeeded -> {
                refreshPersonas(allowAutoEnter = false)
                val loadedIds = _uiState.value.messagesByPersona.keys.toList()
                loadedIds.forEach { pid -> loadInitialOrSyncMessages(pid) }
            }

            is WsDownstreamEvent.Typing -> {
                setPersonaTyping(event.personaId, event.isTyping)
            }

            is WsDownstreamEvent.Bubble -> {
                mergeServerMessage(event.personaId, event.message, fromRealtime = true)
            }

            is WsDownstreamEvent.Proactive -> {
                mergeServerMessage(event.personaId, event.message, fromRealtime = true)
                if (app.isInForeground.value && _uiState.value.activePersonaId != event.personaId) {
                    val pName = _uiState.value.personas.firstOrNull { it.id == event.personaId }?.name ?: "角色"
                    _uiState.update {
                        it.copy(
                            inAppBanner = InAppBanner(
                                personaId = event.personaId,
                                personaName = pName,
                                preview = formatMessagePreview(event.message)
                            )
                        )
                    }
                }
            }

            is WsDownstreamEvent.Recall -> {
                val removeSet = event.messageIds.toHashSet()
                voicePlayer.stopIfPlaying(removeSet)
                _uiState.update { state ->
                    val current = state.messagesByPersona[event.personaId] ?: return@update state
                    val filtered = current.filterNot { it.dto.id in removeSet }
                    sessionStore.saveCachedMessages(event.personaId, filtered.map { it.dto })
                    val nextMap = state.messagesByPersona.toMutableMap()
                    nextMap[event.personaId] = filtered
                    state.copy(messagesByPersona = nextMap)
                }
            }

            is WsDownstreamEvent.SceneState -> {
                val changed = _uiState.value.activeSceneIdByPersona[event.personaId] != event.activeSceneId
                if (changed) clearPersonaHistory(event.personaId)
                _uiState.update { state ->
                    val sId = state.activeSceneIdByPersona.toMutableMap().apply {
                        put(event.personaId, event.activeSceneId)
                    }
                    val sTitle = state.activeSceneTitleByPersona.toMutableMap().apply {
                        put(event.personaId, event.activeSceneTitle)
                    }

                    val updatedPersonas = state.personas.map { p ->
                        if (p.id == event.personaId) {
                            p.copy(
                                activeSceneId = event.activeSceneId,
                                activeSceneTitle = event.activeSceneTitle,
                            )
                        } else p
                    }
                    state.copy(
                        personas = updatedPersonas,
                        activeSceneIdByPersona = sId,
                        activeSceneTitleByPersona = sTitle,
                    )
                }
                if (changed && _uiState.value.activePersonaId == event.personaId) {
                    loadInitialOrSyncMessages(event.personaId)
                }
            }
        }
    }

    private fun setPersonaTyping(personaId: Int, isTyping: Boolean) {
        typingTimeoutJobs.remove(personaId)?.cancel()
        _uiState.update { state ->
            val next = state.typingByPersona.toMutableMap()
            next[personaId] = isTyping
            state.copy(typingByPersona = next)
        }
        if (isTyping) {
            typingTimeoutJobs[personaId] = sessionWork.launch {
                delay(45_000L)
                _uiState.update { state ->
                    val next = state.typingByPersona.toMutableMap()
                    next[personaId] = false
                    state.copy(typingByPersona = next)
                }
            }
        }
    }

    private fun appendOptimisticItem(personaId: Int, item: ChatMessageItem) {
        _uiState.update { state ->
            val current = state.messagesByPersona[personaId].orEmpty()
            val nextMap = state.messagesByPersona.toMutableMap()
            nextMap[personaId] = enrichQuotedSummaries(current + item)
            state.copy(messagesByPersona = nextMap)
        }
    }

    private fun markOptimisticSentOrSync(personaId: Int, tempId: Long) {
        sessionWork.launch {
            delay(450L)
            val stillOptimistic = _uiState.value.messagesByPersona[personaId]
                ?.any { it.dto.id == tempId } == true
            if (stillOptimistic) {
                updateOptimisticStatus(personaId, tempId, SendStatus.SENT)
                syncIncrementalMessages(personaId)
            }
        }
    }

    private fun markOptimisticFailed(personaId: Int, tempId: Long) {
        updateOptimisticStatus(personaId, tempId, SendStatus.FAILED)
    }

    private fun updateOptimisticStatus(personaId: Int, tempId: Long, status: SendStatus) {
        _uiState.update { state ->
            val current = state.messagesByPersona[personaId] ?: return@update state
            val updated = current.map { item ->
                if (item.dto.id == tempId) item.copy(sendStatus = status) else item
            }
            val nextMap = state.messagesByPersona.toMutableMap()
            nextMap[personaId] = updated
            state.copy(messagesByPersona = nextMap)
        }
    }

    /**
     * 三级无重影去重合并引擎：
     * 1. 正数 ID 严格去重原地更新
     * 2. 用户消息自动匹配对应的负数临时乐观项（clientMsgId / 显式 tempId / 同类型同内容最近待确认项）并原地转正
     * 3. 排序保持严格单调（正数 ID 升序在前，未转正负数乐观项按发送时间排末尾）
     */
    private fun mergeServerMessage(
        personaId: Int,
        incoming: MobileMessageDto,
        fromRealtime: Boolean,
        explicitTempId: Long? = null
    ) {
        val activeScene = _uiState.value.activeSceneIdByPersona[personaId]
        val expectedMode = if (activeScene == null) "daily" else "scene"
        if (incoming.id <= 0L || incoming.sceneId != activeScene || incoming.mode != expectedMode) return

        var isBrandNewAssistantVoice = false

        _uiState.update { state ->
            val list = state.messagesByPersona[personaId].orEmpty().toMutableList()
            val existingPositiveIdx = list.indexOfFirst { it.dto.id == incoming.id }

            if (existingPositiveIdx >= 0) {
                // 已存在相同真实服务端 ID：原地更新，同时若还有残留 explicitTempId 一并清理
                val prev = list[existingPositiveIdx]
                list[existingPositiveIdx] = prev.copy(
                    dto = incoming,
                    sendStatus = SendStatus.SENT
                )
                if (explicitTempId != null) {
                    list.removeAll { it.dto.id == explicitTempId }
                }
            } else {
                // 查找是否可合并本地乐观气泡
                val optimisticIdx = if (incoming.isUser) {
                    findMatchingOptimisticIndex(list, incoming, explicitTempId)
                } else {
                    -1
                }

                if (optimisticIdx >= 0) {
                    val oldOpt = list[optimisticIdx]
                    list[optimisticIdx] = ChatMessageItem(
                        dto = incoming,
                        sendStatus = SendStatus.SENT,
                        localPreviewUri = if (incoming.mediaUrl.isNullOrBlank()) oldOpt.localPreviewUri else null,
                        quotedSummary = oldOpt.quotedSummary
                    )
                } else {
                    if (fromRealtime && incoming.isAssistant && incoming.isVoice) {
                        isBrandNewAssistantVoice = true
                    }
                    list.add(ChatMessageItem(dto = incoming, sendStatus = SendStatus.SENT))
                }
            }

            val positives = list.filter { it.dto.id > 0L }
                .distinctBy { it.dto.id }
                .sortedBy { it.dto.id }
            val negatives = list.filter { it.dto.id < 0L }
                .sortedBy { it.createdLocalEpochMs }

            val finalItems = enrichQuotedSummaries(positives + negatives)
            sessionStore.saveCachedMessages(personaId, positives.map { it.dto })

            val nextMap = state.messagesByPersona.toMutableMap()
            nextMap[personaId] = finalItems

            val preview = formatMessagePreview(incoming)
            val updatedPersonas = state.personas.map { p ->
                if (p.id == personaId) {
                    p.copy(
                        lastMessagePreview = preview,
                        lastMessageAt = incoming.createdAt.ifBlank { p.lastMessageAt },
                        emotionalState = incoming.emotionalState?.takeIf { it.isNotBlank() } ?: p.emotionalState
                    )
                } else p
            }

            state.copy(
                messagesByPersona = nextMap,
                personas = updatedPersonas
            )
        }

        // 若前台当前正在该角色对话页且开启了“自动播放角色语音回复”，自动排队播放新收到的助手语音
        if (isBrandNewAssistantVoice &&
            app.isInForeground.value &&
            _uiState.value.autoPlayVoice &&
            _uiState.value.activePersonaId == personaId &&
            !incoming.mediaUrl.isNullOrBlank()
        ) {
            val resolved = UrlResolver.resolveMediaUrl(_uiState.value.baseUrl, incoming.mediaUrl)
            if (!resolved.isNullOrBlank()) {
                voicePlayer.enqueueAutoPlay(incoming.id, resolved)
            }
        }
    }

    private fun findMatchingOptimisticIndex(
        items: List<ChatMessageItem>,
        incoming: MobileMessageDto,
        explicitTempId: Long?
    ): Int {
        if (explicitTempId != null) {
            val idx = items.indexOfFirst { it.dto.id == explicitTempId }
            if (idx >= 0) return idx
        }
        if (!incoming.clientMsgId.isNullOrBlank()) {
            val idx = items.indexOfFirst { it.dto.id < 0L && it.dto.clientMsgId == incoming.clientMsgId }
            if (idx >= 0) return idx
        }
        return items.indexOfFirst { it.dto.id < 0L && isOptimisticMatch(it, incoming) }
    }

    private fun isOptimisticMatch(opt: ChatMessageItem, serverMsg: MobileMessageDto): Boolean {
        if (!serverMsg.isUser || opt.dto.id >= 0L) return false
        val ageMs = System.currentTimeMillis() - opt.createdLocalEpochMs
        if (ageMs > 120_000L) return false
        if (!opt.dto.clientMsgId.isNullOrBlank() && opt.dto.clientMsgId == serverMsg.clientMsgId) {
            return true
        }
        if (!opt.dto.messageType.equals(serverMsg.messageType, ignoreCase = true)) {
            return false
        }
        return when (opt.dto.messageType.lowercase()) {
            "text" -> opt.dto.content.trim() == serverMsg.content.trim()
            "voice", "image" -> true
            else -> opt.dto.content.trim() == serverMsg.content.trim()
        }
    }

    private fun enrichQuotedSummaries(items: List<ChatMessageItem>): List<ChatMessageItem> {
        val byId = items.filter { it.dto.id > 0L }.associateBy { it.dto.id }
        return items.map { item ->
            val replyId = item.dto.replyToMessageId
            if (replyId != null && replyId > 0L && item.quotedSummary.isNullOrBlank()) {
                val target = byId[replyId]?.dto
                if (target != null) {
                    item.copy(quotedSummary = buildQuoteSummary(target))
                } else {
                    item
                }
            } else {
                item
            }
        }
    }

    private fun buildQuoteSummary(msg: MobileMessageDto): String {
        val sender = if (msg.isUser) "我" else (_uiState.value.activePersona?.name ?: "对方")
        val body = formatMessagePreview(msg)
        return "$sender：$body"
    }

    private fun formatMessagePreview(msg: MobileMessageDto): String {
        return when {
            msg.isVoice -> "[语音 ${msg.mediaDuration?.let { "${it}″" } ?: ""}] ${msg.content}".trim()
            msg.isSticker -> "[表情]"
            msg.isImage -> if (msg.content.isNotBlank()) "[图片] ${msg.content}" else "[图片]"
            else -> msg.content.replace('\n', ' ').trim()
        }
    }

    private fun updatePersonaPreview(personaId: Int, preview: String) {
        _uiState.update { state ->
            val updated = state.personas.map { p ->
                if (p.id == personaId) {
                    p.copy(lastMessagePreview = preview, lastMessageAt = Instant.now().toString())
                } else p
            }
            state.copy(personas = updated)
        }
    }

    private fun emitToast(msg: String) {
        _toastEvents.tryEmit(msg)
    }
}
