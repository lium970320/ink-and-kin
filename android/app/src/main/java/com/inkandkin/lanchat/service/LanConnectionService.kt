package com.inkandkin.lanchat.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.inkandkin.lanchat.MainActivity
import com.inkandkin.lanchat.InkAndKinApp
import com.inkandkin.lanchat.R
import com.inkandkin.lanchat.model.ConnectionState
import com.inkandkin.lanchat.model.MobileMessageDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

object NotificationHelper {
    const val CHANNEL_DAEMON = "ink_and_kin_lan_daemon"
    const val CHANNEL_MESSAGES = "ink_and_kin_proactive_messages"
    const val SERVICE_NOTIFICATION_ID = 1001
    const val EXTRA_OPEN_PERSONA_ID = "extra_open_persona_id"

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

        val daemonChannel = NotificationChannel(
            CHANNEL_DAEMON,
            context.getString(R.string.notif_channel_service_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = context.getString(R.string.notif_channel_service_desc)
            setShowBadge(false)
        }

        val msgChannel = NotificationChannel(
            CHANNEL_MESSAGES,
            context.getString(R.string.notif_channel_messages_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.notif_channel_messages_desc)
            enableVibration(true)
            setShowBadge(true)
        }

        nm.createNotificationChannel(daemonChannel)
        nm.createNotificationChannel(msgChannel)
    }

    fun buildDaemonNotification(context: Context, state: ConnectionState, baseUrl: String): Notification {
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            context,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val statusText = when (state) {
            ConnectionState.CONNECTED -> "局域网已直连 · 实时接收主动问候"
            ConnectionState.CONNECTING -> "正在连接台式机 ($baseUrl)…"
            ConnectionState.AUTH_EXPIRED -> "配对凭证需更新 · 点击重新连接"
            ConnectionState.DISCONNECTED -> "等待局域网连接恢复…"
        }

        return NotificationCompat.Builder(context, CHANNEL_DAEMON)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("书中人直连")
            .setContentText(statusText)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    fun showIncomingMessageNotification(
        context: Context,
        personaId: Int,
        personaName: String,
        message: MobileMessageDto,
        isProactive: Boolean
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }

        ensureChannels(context)

        val preview = when {
            message.isVoice -> "[语音消息] ${message.mediaDuration?.let { "${it}″" }.orEmpty()} ${message.content}".trim()
            message.isSticker -> "[表情]"
            message.isImage -> if (message.content.isNotBlank()) "[图片] ${message.content}" else "[发来一张照片]"
            else -> message.content.ifBlank { "发来一条新消息" }
        }

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_OPEN_PERSONA_ID, personaId)
        }
        val pi = PendingIntent.getActivity(
            context,
            2000 + personaId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = if (isProactive) "$personaName · 主动问候" else personaName

        val notif = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(preview)
            .setStyle(NotificationCompat.BigTextStyle().bigText(preview))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()

        runCatching {
            NotificationManagerCompat.from(context).notify(3000 + personaId, notif)
        }
    }
}

class LanConnectionService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.ensureChannels(this)
        val app = application as InkAndKinApp

        serviceScope.launch {
            app.realtimeHub.connectionState.collect { state ->
                if (running && app.sessionStore.isAuthenticated && app.sessionStore.keepAliveEnabled) {
                    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                    nm?.notify(
                        NotificationHelper.SERVICE_NOTIFICATION_ID,
                        NotificationHelper.buildDaemonNotification(
                            this@LanConnectionService,
                            state,
                            app.sessionStore.baseUrl
                        )
                    )
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as InkAndKinApp
        if (!app.sessionStore.isAuthenticated || !app.sessionStore.keepAliveEnabled ||
            !promoteToForeground(app.realtimeHub.connectionState.value, app.sessionStore.baseUrl)
        ) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        running = true
        app.realtimeHub.ensureConnected()
        return START_NOT_STICKY
    }

    private fun promoteToForeground(state: ConnectionState, baseUrl: String): Boolean {
        val notif = NotificationHelper.buildDaemonNotification(this, state, baseUrl)
        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(
                    this,
                    NotificationHelper.SERVICE_NOTIFICATION_ID,
                    notif,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                )
            } else {
                startForeground(NotificationHelper.SERVICE_NOTIFICATION_ID, notif)
            }
        }.isSuccess
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        val app = application as InkAndKinApp
        if (!app.isInForeground.value) app.realtimeHub.disconnect()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        serviceScope.cancel()
        val app = application as InkAndKinApp
        if (!app.isInForeground.value) app.realtimeHub.disconnect()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        @Volatile
        var running = false
            private set

        fun syncServiceState(context: Context) {
            val app = context.applicationContext as? InkAndKinApp ?: return
            val intent = Intent(app, LanConnectionService::class.java)
            if (app.sessionStore.isAuthenticated && app.sessionStore.keepAliveEnabled) {
                if (app.isInForeground.value && !running) {
                    runCatching { ContextCompat.startForegroundService(app, intent) }
                }
            } else {
                runCatching { app.stopService(intent) }
            }
        }
    }
}
