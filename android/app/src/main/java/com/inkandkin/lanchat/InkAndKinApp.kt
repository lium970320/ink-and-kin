package com.inkandkin.lanchat

import android.app.Application
import android.app.NotificationManager
import android.os.Build
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.decode.GifDecoder
import coil.decode.ImageDecoderDecoder
import coil.request.CachePolicy
import com.inkandkin.lanchat.data.LanDiscoveryClient
import com.inkandkin.lanchat.data.LanRealtimeHub
import com.inkandkin.lanchat.data.InkAndKinApiClient
import com.inkandkin.lanchat.data.SessionStore
import com.inkandkin.lanchat.data.WsDownstreamEvent
import com.inkandkin.lanchat.media.VoicePlayerManager
import com.inkandkin.lanchat.service.LanConnectionService
import com.inkandkin.lanchat.service.NotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class InkAndKinApp : Application(), ImageLoaderFactory {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    lateinit var sessionStore: SessionStore
        private set

    lateinit var apiClient: InkAndKinApiClient
        private set

    lateinit var discoveryClient: LanDiscoveryClient
        private set

    lateinit var realtimeHub: LanRealtimeHub
        private set

    lateinit var voicePlayerManager: VoicePlayerManager
        private set

    private val _isInForeground = MutableStateFlow(false)
    val isInForeground: StateFlow<Boolean> = _isInForeground.asStateFlow()

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.ensureChannels(this)

        sessionStore = SessionStore(this)
        apiClient = InkAndKinApiClient(sessionStore)
        discoveryClient = LanDiscoveryClient(this, apiClient)
        realtimeHub = LanRealtimeHub(this, sessionStore, apiClient)
        voicePlayerManager = VoicePlayerManager(this, apiClient.mediaHttpClient)

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                _isInForeground.value = true
                if (sessionStore.isAuthenticated) {
                    realtimeHub.ensureConnected()
                    LanConnectionService.syncServiceState(this@InkAndKinApp)
                }
            }

            override fun onStop(owner: LifecycleOwner) {
                _isInForeground.value = false
                if (!LanConnectionService.running) {
                    realtimeHub.disconnect()
                }
            }
        })

        // 监听后台实时事件：在锁屏/后台收到角色主动问候或新助手回复时弹出系统高优通知
        appScope.launch {
            realtimeHub.events.collect { event ->
                when (event) {
                    is WsDownstreamEvent.Proactive -> {
                        if (!_isInForeground.value) {
                            val name = lookupPersonaName(event.personaId)
                            NotificationHelper.showIncomingMessageNotification(
                                context = this@InkAndKinApp,
                                personaId = event.personaId,
                                personaName = name,
                                message = event.message,
                                isProactive = true
                            )
                        }
                    }

                    is WsDownstreamEvent.Bubble -> {
                        if (!_isInForeground.value && event.message.isAssistant) {
                            val name = lookupPersonaName(event.personaId)
                            NotificationHelper.showIncomingMessageNotification(
                                context = this@InkAndKinApp,
                                personaId = event.personaId,
                                personaName = name,
                                message = event.message,
                                isProactive = false
                            )
                        }
                    }

                    else -> Unit
                }
            }
        }

    }

    fun clearSessionNotifications() {
        getSystemService(NotificationManager::class.java)?.cancelAll()
    }

    private fun lookupPersonaName(personaId: Int): String {
        return sessionStore.loadCachedPersonas()
            .firstOrNull { it.id == personaId }
            ?.name
            ?: "书中人"
    }

    override fun newImageLoader(): ImageLoader {
        return ImageLoader.Builder(this)
            .okHttpClient(apiClient.mediaHttpClient)
            .diskCachePolicy(CachePolicy.DISABLED)
            .memoryCachePolicy(CachePolicy.DISABLED)
            .components {
                if (Build.VERSION.SDK_INT >= 28) {
                    add(ImageDecoderDecoder.Factory())
                } else {
                    add(GifDecoder.Factory())
                }
            }
            .crossfade(true)
            .build()
    }
}
