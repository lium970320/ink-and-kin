package com.inkandkin.lanchat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.util.Consumer
import com.inkandkin.lanchat.data.UrlResolver
import com.inkandkin.lanchat.service.NotificationHelper
import com.inkandkin.lanchat.ui.InAppBanner
import com.inkandkin.lanchat.ui.InkAndKinViewModel
import com.inkandkin.lanchat.ui.components.SettingsBottomSheet
import com.inkandkin.lanchat.ui.screens.ChatScreen
import com.inkandkin.lanchat.ui.screens.PairingScreen
import com.inkandkin.lanchat.ui.screens.PersonaListScreen
import com.inkandkin.lanchat.ui.theme.LocalInkAndKinPalette
import com.inkandkin.lanchat.ui.theme.InkAndKinTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val viewModel: InkAndKinViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        if (savedInstanceState == null) {
            dispatchIncomingIntent(intent)
        }

        setContent {
            InkAndKinTheme {
                val state by viewModel.uiState.collectAsState()
                val snackbarHostState = remember { SnackbarHostState() }
                val scope = rememberCoroutineScope()
                var showSettingsSheet by rememberSaveable { mutableStateOf(false) }
                var requestedNotifOnce by rememberSaveable { mutableStateOf(false) }

                val notifPermissionLauncher = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.RequestPermission()
                ) { _ -> }

                // 监听运行期 singleTask 新到达的扫码 Deep Link 或系统通知点击
                DisposableEffect(Unit) {
                    val listener = Consumer<Intent> { newIntent ->
                        dispatchIncomingIntent(newIntent)
                    }
                    addOnNewIntentListener(listener)
                    onDispose {
                        removeOnNewIntentListener(listener)
                    }
                }

                // 首次配对成功后温和申请 Android 13+ 通知权限以支持后台主动问候提醒
                LaunchedEffect(state.isAuthenticated, state.keepAliveEnabled) {
                    if (state.isAuthenticated &&
                        state.keepAliveEnabled &&
                        !requestedNotifOnce &&
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ) {
                        val granted = ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.POST_NOTIFICATIONS
                        ) == PackageManager.PERMISSION_GRANTED
                        if (!granted) {
                            requestedNotifOnce = true
                            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                    }
                }

                // 自动收起前台主动问候浮层
                LaunchedEffect(state.inAppBanner) {
                    if (state.inAppBanner != null) {
                        delay(5500L)
                        viewModel.dismissInAppBanner()
                    }
                }

                // 收集轻提示
                LaunchedEffect(Unit) {
                    viewModel.toastEvents.collect { msg ->
                        snackbarHostState.currentSnackbarData?.dismiss()
                        snackbarHostState.showSnackbar(msg)
                    }
                }

                Box(modifier = Modifier.fillMaxSize()) {
                    val currentScreenKey = when {
                        !state.isAuthenticated -> "pairing"
                        state.activePersona != null -> "chat_${state.activePersona!!.id}"
                        else -> "persona_list"
                    }

                    AnimatedContent(
                        targetState = currentScreenKey,
                        transitionSpec = { fadeIn() togetherWith fadeOut() },
                        label = "mainScreenNav"
                    ) { screen ->
                        when {
                            screen == "pairing" -> {
                                PairingScreen(
                                    state = state,
                                    onUrlChange = viewModel::updatePairInputUrl,
                                    onCodeChange = viewModel::updatePairInputCode,
                                    onScanLan = viewModel::scanLanServers,
                                    onSelectServer = viewModel::selectDiscoveredServer,
                                    onPingUrl = { viewModel.pingManualUrl() },
                                    onPairWithCode = { viewModel.pairWithCode() },
                                    onLoginWithPassword = { u, p ->
                                        viewModel.loginWithPassword(state.pairInputUrl, u, p)
                                    }
                                )
                            }

                            screen.startsWith("chat_") && state.activePersona != null -> {
                                val persona = state.activePersona!!
                                ChatScreen(
                                    persona = persona,
                                    state = state,
                                    voicePlayer = viewModel.voicePlayer,
                                    onBack = viewModel::navigateBackToPersonaList,
                                    onOpenSettings = { showSettingsSheet = true },
                                    onSendText = { txt -> viewModel.sendText(persona.id, txt) },
                                    onSendVoice = { clip -> viewModel.sendRecordedVoice(persona.id, clip) },
                                    onPickImage = { uri -> viewModel.sendPickedImage(persona.id, uri) },
                                    onRetryMessage = { item -> viewModel.retryFailedMessage(persona.id, item) },
                                    onUserTyping = { viewModel.onUserInputTyping(persona.id) },
                                    onStopTurn = { viewModel.stopAssistantTurn(persona.id) },
                                    onSetReplyTarget = viewModel::setReplyTarget,
                                    onLoadOlder = { viewModel.loadOlderMessages(persona.id) },
                                    onOpenScenePicker = { viewModel.loadScenes(persona.id) },
                                    onSwitchScene = { sid, stitle ->
                                        viewModel.switchScene(persona.id, sid, stitle)
                                    },
                                    onResetSegment = { viewModel.resetConversationSegment(persona.id) },
                                    onShowHint = { hint ->
                                        scope.launch {
                                            snackbarHostState.currentSnackbarData?.dismiss()
                                            snackbarHostState.showSnackbar(hint)
                                        }
                                    }
                                )
                            }

                            else -> {
                                PersonaListScreen(
                                    state = state,
                                    onSelectPersona = viewModel::openPersonaChat,
                                    onRefresh = { viewModel.refreshPersonas(allowAutoEnter = false) },
                                    onOpenSettings = { showSettingsSheet = true }
                                )
                            }
                        }
                    }

                    // 前台其他页面收到角色主动问候时的温润浮层卡片
                    AnimatedVisibility(
                        visible = state.inAppBanner != null,
                        enter = slideInVertically { -it } + fadeIn(),
                        exit = slideOutVertically { -it } + fadeOut(),
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .statusBarsPadding()
                            .padding(horizontal = 16.dp, vertical = 10.dp)
                    ) {
                        state.inAppBanner?.let { banner ->
                            InAppProactiveBanner(
                                banner = banner,
                                onClick = { viewModel.openPersonaChat(banner.personaId) },
                                onDismiss = viewModel::dismissInAppBanner
                            )
                        }
                    }

                    // 设置底部抽屉
                    if (showSettingsSheet && state.isAuthenticated) {
                        SettingsBottomSheet(
                            state = state,
                            onDismiss = { showSettingsSheet = false },
                            onSelectProactiveMode = viewModel::updateProactiveTargetMode,
                            onScanLan = viewModel::scanLanServers,
                            onSelectServer = viewModel::selectDiscoveredServer,
                            onApplyManualUrl = { rawUrl -> viewModel.pingManualUrl(rawUrl) },
                            onToggleKeepAlive = { enabled ->
                                if (enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                    val granted = ContextCompat.checkSelfPermission(
                                        this@MainActivity,
                                        Manifest.permission.POST_NOTIFICATIONS
                                    ) == PackageManager.PERMISSION_GRANTED
                                    if (!granted) {
                                        notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                    }
                                }
                                viewModel.setKeepAliveEnabled(enabled)
                            },
                            onToggleAutoPlayVoice = viewModel::setAutoPlayVoice,
                            onCheckVersion = { viewModel.checkAppVersion(showUpToDateToast = false) },
                            onLogout = viewModel::logoutAndUnpair
                        )
                    }

                    SnackbarHost(
                        hostState = snackbarHostState,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .navigationBarsPadding()
                            .padding(bottom = 68.dp)
                    )
                }
            }
        }
    }

    private fun dispatchIncomingIntent(incoming: Intent?) {
        if (incoming == null) return

        // 1. 检查扫码一键配对 Deep Link: ink-and-kin://pair?url=...&code=...
        val deepLink = UrlResolver.parsePairDeepLink(incoming.data)
        if (deepLink != null) {
            viewModel.handlePairDeepLink(deepLink)
            incoming.data = null
            return
        }

        // 2. 检查系统通知栏点击携带的目标角色 ID
        val openPersonaId = incoming.getIntExtra(NotificationHelper.EXTRA_OPEN_PERSONA_ID, -1)
        if (openPersonaId > 0) {
            viewModel.openPersonaFromNotification(openPersonaId)
            incoming.removeExtra(NotificationHelper.EXTRA_OPEN_PERSONA_ID)
        }
    }
}

@Composable
private fun InAppProactiveBanner(
    banner: InAppBanner,
    onClick: () -> Unit,
    onDismiss: () -> Unit
) {
    val palette = LocalInkAndKinPalette.current
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = palette.cardBg,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.45f)),
        shadowElevation = 6.dp,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Outlined.NotificationsActive,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(22.dp)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "${banner.personaName} · 主动问候",
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = banner.preview,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            IconButton(onClick = onDismiss, modifier = Modifier.size(28.dp)) {
                Icon(
                    imageVector = Icons.Outlined.Close,
                    contentDescription = "忽略",
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}
