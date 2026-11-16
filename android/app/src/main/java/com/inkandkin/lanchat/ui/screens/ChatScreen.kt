package com.inkandkin.lanchat.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.inkandkin.lanchat.data.UrlResolver
import com.inkandkin.lanchat.media.RecordedVoicePayload
import com.inkandkin.lanchat.media.VoicePlayerManager
import com.inkandkin.lanchat.media.VoiceRecorderManager
import com.inkandkin.lanchat.model.ChatMessageItem
import com.inkandkin.lanchat.model.MobileMessageDto
import com.inkandkin.lanchat.model.PersonaSummaryDto
import com.inkandkin.lanchat.model.ScenesResponseDto
import com.inkandkin.lanchat.model.SendStatus
import com.inkandkin.lanchat.ui.InkAndKinUiState
import com.inkandkin.lanchat.ui.theme.LocalInkAndKinPalette
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    persona: PersonaSummaryDto,
    state: InkAndKinUiState,
    voicePlayer: VoicePlayerManager,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
    onSendText: (String) -> Unit,
    onSendVoice: (RecordedVoicePayload) -> Unit,
    onPickImage: (Uri) -> Unit,
    onRetryMessage: (ChatMessageItem) -> Unit,
    onUserTyping: () -> Unit,
    onStopTurn: () -> Unit,
    onSetReplyTarget: (MobileMessageDto?) -> Unit,
    onLoadOlder: () -> Unit,
    onOpenScenePicker: () -> Unit,
    onSwitchScene: (Int?, String?) -> Unit,
    onResetSegment: () -> Unit,
    onShowHint: (String) -> Unit
) {
    BackHandler(onBack = onBack)

    val context = LocalContext.current
    val palette = LocalInkAndKinPalette.current
    val density = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    val personaId = persona.id
    val messages = state.messagesByPersona[personaId].orEmpty()
    val hasMore = state.hasMoreByPersona[personaId] == true
    val isLoadingInitial = state.loadingMessagesPersonaId == personaId && messages.isEmpty()
    val isLoadingOlder = state.loadingOlderPersonaId == personaId
    val isTyping = state.typingByPersona[personaId] == true
    val activeSceneId = state.activeSceneIdByPersona.getOrDefault(personaId, persona.activeSceneId)
    val activeSceneTitle = state.activeSceneTitleByPersona.getOrDefault(personaId, persona.activeSceneTitle)

    val playingMsgId by voicePlayer.playingMessageId.collectAsState()
    val bufferingMsgId by voicePlayer.bufferingMessageId.collectAsState()

    val recorder = remember { VoiceRecorderManager(context) }
    val isRecording by recorder.isRecording.collectAsState()
    val recordAmplitude by recorder.amplitude.collectAsState()
    val recordElapsedSec by recorder.elapsedSeconds.collectAsState()
    var isSlideCanceling by remember { mutableStateOf(false) }

    DisposableEffect(personaId) {
        onDispose {
            recorder.cancelRecording()
        }
    }

    var inputText by rememberSaveable(personaId) { mutableStateOf("") }
    var voiceInputMode by rememberSaveable(personaId) { mutableStateOf(false) }
    var showSceneSheet by remember { mutableStateOf(false) }
    var showResetConfirm by remember { mutableStateOf(false) }
    var previewImageUrl by remember { mutableStateOf<String?>(null) }

    val listState = rememberLazyListState()
    var initialPositioned by remember(personaId) { mutableStateOf(false) }
    val imeBottomPx = WindowInsets.ime.getBottom(density)

    // 首次进入秒定位到底部；后续新气泡或软键盘弹起平滑滚到底部
    LaunchedEffect(personaId, messages.size, messages.lastOrNull()?.id) {
        if (messages.isNotEmpty()) {
            val targetIdx = messages.lastIndex
            if (!initialPositioned) {
                listState.scrollToItem(targetIdx)
                initialPositioned = true
            } else {
                val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
                val lastMsg = messages.last()
                if (lastMsg.dto.isUser || targetIdx - lastVisible <= 4) {
                    listState.animateScrollToItem(targetIdx)
                }
            }
        }
    }

    LaunchedEffect(imeBottomPx) {
        if (imeBottomPx > 0 && messages.isNotEmpty()) {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            if (messages.lastIndex - lastVisible <= 3) {
                listState.animateScrollToItem(messages.lastIndex)
            }
        }
    }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri: Uri? ->
        if (uri != null) {
            onPickImage(uri)
        }
    }

    val audioPermLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            onShowHint("麦克风已授权，请按住说话")
        } else {
            onShowHint("需要麦克风权限才能发送语音消息")
        }
    }

    if (showResetConfirm) {
        AlertDialog(
            onDismissRequest = { showResetConfirm = false },
            title = { Text("新开本段对话？") },
            text = { Text("将开启一段全新的对话上下文，历史记录仍安全保留在台式机中。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showResetConfirm = false
                        onResetSegment()
                    }
                ) {
                    Text("确认新开")
                }
            },
            dismissButton = {
                TextButton(onClick = { showResetConfirm = false }) {
                    Text("取消")
                }
            }
        )
    }

    if (showSceneSheet) {
        ScenePickerBottomSheet(
            scenesState = state.scenesState,
            isLoading = state.isLoadingScenes,
            currentSceneId = activeSceneId,
            onDismiss = { showSceneSheet = false },
            onSelectDaily = {
                showSceneSheet = false
                onSwitchScene(null, null)
            },
            onSelectScene = { id, title ->
                showSceneSheet = false
                onSwitchScene(id, title)
            }
        )
    }

    if (previewImageUrl != null) {
        FullscreenImageDialog(
            imageUrl = previewImageUrl!!,
            onDismiss = { previewImageUrl = null }
        )
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.pageBg)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // 1. 顶栏：角色头像 + 名称 + 动态呼吸状态/剧场标签
            ChatTopBar(
                baseUrl = state.baseUrl,
                persona = persona,
                isTyping = isTyping,
                activeSceneTitle = activeSceneTitle,
                onBack = onBack,
                onClickScene = {
                    onOpenScenePicker()
                    showSceneSheet = true
                },
                onOpenSettings = onOpenSettings
            )

            // 2. 消息流主体
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
            ) {
                if (isLoadingInitial) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(strokeWidth = 2.2.dp)
                    }
                } else if (messages.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 36.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "与 ${persona.name} 直连就绪",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = if (!activeSceneTitle.isNullOrBlank()) {
                                    "当前剧场：$activeSceneTitle"
                                } else {
                                    "发送一条消息，或点下方「拍一张」看看此刻状态"
                                },
                                style = MaterialTheme.typography.bodyMedium,
                                color = palette.subtleText
                            )
                        }
                    }
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        if (hasMore) {
                            item(key = "load_older_header") {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 4.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (isLoadingOlder) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(18.dp),
                                            strokeWidth = 2.dp
                                        )
                                    } else {
                                        Surface(
                                            shape = RoundedCornerShape(999.dp),
                                            color = palette.chipBg,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(999.dp))
                                                .clickable { onLoadOlder() }
                                        ) {
                                            Text(
                                                text = "加载更早的对话",
                                                style = MaterialTheme.typography.labelMedium,
                                                color = palette.chipContent,
                                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        items(messages, key = { it.id }) { item ->
                            MessageRow(
                                baseUrl = state.baseUrl,
                                persona = persona,
                                item = item,
                                isPlayingVoice = playingMsgId == item.id,
                                isBufferingVoice = bufferingMsgId == item.id,
                                onToggleVoice = { resolvedAudioUrl ->
                                    voicePlayer.togglePlay(item.id, resolvedAudioUrl)
                                },
                                onClickImage = { imgUrl ->
                                    previewImageUrl = imgUrl
                                },
                                onQuoteMessage = { dto ->
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onSetReplyTarget(dto)
                                },
                                onCopiedToast = {
                                    onShowHint("已复制消息文本")
                                },
                                onRetry = {
                                    onRetryMessage(item)
                                }
                            )
                        }
                    }
                }
            }

            // 3. 底部输入与快捷胶囊区（平滑适配软键盘 imePadding）
            Surface(
                color = palette.barBg,
                shadowElevation = 2.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .imePadding()
                        .padding(top = 6.dp, bottom = 8.dp)
                ) {
                    // 引用回复条
                    AnimatedVisibility(visible = state.replyingToMessage != null) {
                        val replyTarget = state.replyingToMessage
                        if (replyTarget != null) {
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = palette.cardBg,
                                border = BorderStroke(0.7.dp, palette.cardBorder),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 12.dp, vertical = 4.dp)
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = Icons.AutoMirrored.Outlined.Reply,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = buildString {
                                            append(if (replyTarget.isUser) "引用我的消息：" else "引用 ${persona.name}：")
                                            append(
                                                when {
                                                    replyTarget.isVoice -> "[语音消息]"
                                                    replyTarget.isImage -> "[图片]"
                                                    else -> replyTarget.content.replace('\n', ' ')
                                                }
                                            )
                                        },
                                        style = MaterialTheme.typography.labelMedium,
                                        color = palette.narrationText,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )
                                    IconButton(
                                        onClick = { onSetReplyTarget(null) },
                                        modifier = Modifier.size(24.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Outlined.Close,
                                            contentDescription = "取消引用",
                                            modifier = Modifier.size(15.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // 横向快捷胶囊栏：拍一张 / 切换场景 / 新开本段 / 停止回复
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        item {
                            QuickActionChip(
                                icon = Icons.Outlined.CameraAlt,
                                label = "拍一张",
                                onClick = { onSendText("/p") }
                            )
                        }
                        item {
                            QuickActionChip(
                                icon = Icons.Outlined.AutoStories,
                                label = when {
                                    !activeSceneTitle.isNullOrBlank() -> "场景 · $activeSceneTitle"
                                    else -> "切换场景"
                                },
                                highlighted = !activeSceneTitle.isNullOrBlank(),
                                onClick = {
                                    onOpenScenePicker()
                                    showSceneSheet = true
                                }
                            )
                        }
                        item {
                            QuickActionChip(
                                icon = Icons.Outlined.RestartAlt,
                                label = "新开本段",
                                onClick = { showResetConfirm = true }
                            )
                        }
                        item {
                            QuickActionChip(
                                icon = Icons.Outlined.StopCircle,
                                label = "停止回复",
                                enabled = isTyping,
                                dangerHighlight = isTyping,
                                onClick = onStopTurn
                            )
                        }
                    }

                    // 主输入控制行
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.Bottom
                    ) {
                        // 语音 / 键盘切换
                        IconButton(
                            onClick = { voiceInputMode = !voiceInputMode },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                imageVector = if (voiceInputMode) Icons.Outlined.Keyboard else Icons.Outlined.Mic,
                                contentDescription = if (voiceInputMode) "切换键盘" else "切换语音",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        if (voiceInputMode) {
                            // 按住说话长条按钮（支持上滑取消）
                            val cancelThresholdPx = with(density) { 64.dp.toPx() }
                            Surface(
                                shape = RoundedCornerShape(22.dp),
                                color = if (isRecording) {
                                    MaterialTheme.colorScheme.primaryContainer
                                } else {
                                    palette.cardBg
                                },
                                border = BorderStroke(0.9.dp, palette.cardBorder),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(46.dp)
                                    .clip(RoundedCornerShape(22.dp))
                                    .pointerInput(personaId) {
                                        awaitEachGesture {
                                            val down = awaitFirstDown(requireUnconsumed = false)
                                            val hasPerm = ContextCompat.checkSelfPermission(
                                                context,
                                                Manifest.permission.RECORD_AUDIO
                                            ) == PackageManager.PERMISSION_GRANTED
                                            if (!hasPerm) {
                                                audioPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                                return@awaitEachGesture
                                            }

                                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                            isSlideCanceling = false
                                            val started = recorder.startRecording()
                                            if (!started) {
                                                onShowHint("无法启动麦克风录音")
                                                return@awaitEachGesture
                                            }

                                            val startY = down.position.y
                                            var pointerActive = true
                                            var canceledByGesture = false

                                            while (pointerActive) {
                                                val event = awaitPointerEvent()
                                                val change = event.changes.firstOrNull { it.id == down.id }
                                                    ?: event.changes.firstOrNull()
                                                if (change == null || !change.pressed) {
                                                    pointerActive = false
                                                } else {
                                                    val dy = change.position.y - startY
                                                    isSlideCanceling = dy < -cancelThresholdPx
                                                    change.consume()
                                                }
                                            }

                                            canceledByGesture = isSlideCanceling
                                            isSlideCanceling = false
                                            if (canceledByGesture) {
                                                recorder.cancelRecording()
                                                onShowHint("已取消发送语音")
                                            } else {
                                                scope.launch {
                                                    recorder.stopAndEncode()
                                                        .onSuccess { clip -> onSendVoice(clip) }
                                                        .onFailure { err ->
                                                            onShowHint(err.message ?: "说话时间太短")
                                                        }
                                                }
                                            }
                                        }
                                    }
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(
                                        text = when {
                                            isRecording && isSlideCanceling -> "松开手指，取消发送"
                                            isRecording -> "松开发送 · 上滑取消"
                                            else -> "按住 说话"
                                        },
                                        style = MaterialTheme.typography.titleMedium,
                                        color = if (isSlideCanceling) {
                                            MaterialTheme.colorScheme.error
                                        } else {
                                            MaterialTheme.colorScheme.onSurface
                                        }
                                    )
                                }
                            }
                        } else {
                            OutlinedTextField(
                                value = inputText,
                                onValueChange = { next ->
                                    inputText = next
                                    if (next.isNotBlank()) {
                                        onUserTyping()
                                    }
                                },
                                placeholder = {
                                    Text(
                                        text = "发消息给 ${persona.name}…",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = palette.subtleText
                                    )
                                },
                                maxLines = 5,
                                shape = RoundedCornerShape(22.dp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedContainerColor = palette.cardBg,
                                    unfocusedContainerColor = palette.cardBg,
                                    unfocusedBorderColor = palette.cardBorder,
                                    focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
                                ),
                                modifier = Modifier
                                    .weight(1f)
                                    .heightIn(min = 46.dp)
                            )
                        }

                        // 相册选图按钮
                        IconButton(
                            onClick = {
                                photoPickerLauncher.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                )
                            },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.AddPhotoAlternate,
                                contentDescription = "选择图片发送",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        // 发送按钮
                        val canSend = !voiceInputMode && inputText.trim().isNotEmpty()
                        if (canSend) {
                            Surface(
                                shape = CircleShape,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier
                                    .padding(end = 4.dp, bottom = 3.dp)
                                    .size(40.dp)
                                    .clip(CircleShape)
                                    .clickable {
                                        val toSend = inputText
                                        inputText = ""
                                        onSendText(toSend)
                                    }
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        imageVector = Icons.AutoMirrored.Outlined.Send,
                                        contentDescription = "发送",
                                        tint = MaterialTheme.colorScheme.onPrimary,
                                        modifier = Modifier.size(19.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // 录音中央实时声波浮层
        if (isRecording) {
            VoiceRecordingOverlay(
                amplitude = recordAmplitude,
                elapsedSeconds = recordElapsedSec,
                isCancelState = isSlideCanceling,
                modifier = Modifier.align(Alignment.Center)
            )
        }
    }
}

@Composable
private fun ChatTopBar(
    baseUrl: String,
    persona: PersonaSummaryDto,
    isTyping: Boolean,
    activeSceneTitle: String?,
    onBack: () -> Unit,
    onClickScene: () -> Unit,
    onOpenSettings: () -> Unit
) {
    val palette = LocalInkAndKinPalette.current
    val avatarUrl = UrlResolver.resolveMediaUrl(baseUrl, persona.avatarUrl)

    val infinite = rememberInfiniteTransition(label = "typingPulse")
    val pulseAlpha by infinite.animateFloat(
        initialValue = 0.4f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(tween(650), RepeatMode.Reverse),
        label = "pulseAlpha"
    )

    Surface(
        color = palette.barBg,
        shadowElevation = 0.8.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 6.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = "返回角色列表"
                )
            }

            PersonaAvatar(
                avatarUrl = avatarUrl,
                name = persona.name,
                sizeDp = 38
            )

            Spacer(modifier = Modifier.width(10.dp))

            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable(onClick = onClickScene)
            ) {
                Text(
                    text = persona.name,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                if (isTyping) {
                    Text(
                        text = "对方正在输入…",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.alpha(pulseAlpha)
                    )
                } else {
                    val subtitle = when {
                        !activeSceneTitle.isNullOrBlank() -> "剧场 · $activeSceneTitle"
                        !persona.emotionalState.isNullOrBlank() -> persona.emotionalState
                        !persona.scheduleSummary.isNullOrBlank() -> persona.scheduleSummary
                        else -> "局域网实时对话"
                    }
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.labelMedium,
                        color = palette.subtleText,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            IconButton(onClick = onClickScene) {
                Icon(
                    imageVector = Icons.Outlined.AutoStories,
                    contentDescription = "切换剧场场景",
                    tint = if (!activeSceneTitle.isNullOrBlank()) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
            }

            IconButton(onClick = onOpenSettings) {
                Icon(
                    imageVector = Icons.Outlined.Settings,
                    contentDescription = "设置",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun QuickActionChip(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    enabled: Boolean = true,
    highlighted: Boolean = false,
    dangerHighlight: Boolean = false,
    onClick: () -> Unit
) {
    val palette = LocalInkAndKinPalette.current
    val bgColor = when {
        dangerHighlight -> MaterialTheme.colorScheme.error.copy(alpha = 0.14f)
        highlighted -> MaterialTheme.colorScheme.primaryContainer
        else -> palette.chipBg
    }
    val contentColor = when {
        !enabled -> palette.subtleText.copy(alpha = 0.45f)
        dangerHighlight -> MaterialTheme.colorScheme.error
        highlighted -> MaterialTheme.colorScheme.onPrimaryContainer
        else -> palette.chipContent
    }

    Surface(
        shape = RoundedCornerShape(999.dp),
        color = bgColor,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .clickable(enabled = enabled, onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 11.dp, vertical = 5.5.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = contentColor,
                modifier = Modifier.size(14.dp)
            )
            Spacer(modifier = Modifier.width(5.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
                color = contentColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageRow(
    baseUrl: String,
    persona: PersonaSummaryDto,
    item: ChatMessageItem,
    isPlayingVoice: Boolean,
    isBufferingVoice: Boolean,
    onToggleVoice: (String) -> Unit,
    onClickImage: (String) -> Unit,
    onQuoteMessage: (MobileMessageDto) -> Unit,
    onCopiedToast: () -> Unit,
    onRetry: () -> Unit
) {
    val palette = LocalInkAndKinPalette.current
    val clipboard = LocalClipboardManager.current
    val dto = item.dto
    val isUser = dto.isUser
    var showMenu by remember { mutableStateOf(false) }

    val resolvedMediaUrl = item.localPreviewUri?.takeIf { it.isNotBlank() }
        ?: UrlResolver.resolveMediaUrl(baseUrl, dto.mediaUrl)

    val isLiteraryScene = !isUser && !dto.isVoice && !dto.isImage &&
        (dto.isSceneMode || looksLikeSceneNarration(dto.content))

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom
    ) {
        if (!isUser) {
            PersonaAvatar(
                avatarUrl = UrlResolver.resolveMediaUrl(baseUrl, persona.avatarUrl),
                name = persona.name,
                sizeDp = 32
            )
            Spacer(modifier = Modifier.width(8.dp))
        }

        // 发送中 / 失败重试指示器（用户气泡左侧）
        if (isUser && item.sendStatus != SendStatus.SENT) {
            Box(modifier = Modifier.padding(end = 6.dp, bottom = 6.dp)) {
                when (item.sendStatus) {
                    SendStatus.SENDING -> CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 1.6.dp,
                        color = palette.subtleText
                    )

                    SendStatus.FAILED -> IconButton(
                        onClick = onRetry,
                        modifier = Modifier.size(24.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.ErrorOutline,
                            contentDescription = "点击重发",
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    SendStatus.SENT -> Unit
                }
            }
        }

        Box {
            when {
                // 1. 无边框情绪表情包展示
                dto.isSticker && !resolvedMediaUrl.isNullOrBlank() -> {
                    AsyncImage(
                        model = resolvedMediaUrl,
                        contentDescription = "情绪表情",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .size(132.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .combinedClickable(
                                onClick = { onClickImage(resolvedMediaUrl) },
                                onLongClick = { showMenu = true }
                            )
                    )
                }

                // 2. 图片 / 角色自拍气泡
                dto.isImage && !resolvedMediaUrl.isNullOrBlank() -> {
                    Surface(
                        shape = RoundedCornerShape(18.dp),
                        color = if (isUser) palette.userBubbleBg else palette.assistantBubbleBg,
                        border = if (isUser) null else BorderStroke(0.8.dp, palette.assistantBubbleBorder),
                        modifier = Modifier
                            .widthIn(max = 240.dp)
                            .clip(RoundedCornerShape(18.dp))
                            .combinedClickable(
                                onClick = { onClickImage(resolvedMediaUrl) },
                                onLongClick = { showMenu = true }
                            )
                    ) {
                        Column {
                            AsyncImage(
                                model = resolvedMediaUrl,
                                contentDescription = "照片",
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 120.dp, max = 290.dp)
                            )
                            if (dto.content.isNotBlank()) {
                                Text(
                                    text = dto.content,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = if (isUser) palette.userBubbleText else palette.assistantBubbleText,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                                )
                            }
                        }
                    }
                }

                // 3. 语音条气泡
                dto.isVoice -> {
                    val dur = (dto.mediaDuration ?: 3).coerceAtLeast(1)
                    val bubbleWidth = (96 + (dur.coerceAtMost(35) * 3.6f).toInt()).dp
                    Surface(
                        shape = RoundedCornerShape(
                            topStart = 18.dp,
                            topEnd = 18.dp,
                            bottomStart = if (isUser) 18.dp else 5.dp,
                            bottomEnd = if (isUser) 5.dp else 18.dp
                        ),
                        color = if (isUser) palette.userBubbleBg else palette.assistantBubbleBg,
                        border = if (isUser) null else BorderStroke(0.8.dp, palette.assistantBubbleBorder),
                        modifier = Modifier
                            .widthIn(min = bubbleWidth, max = 268.dp)
                            .clip(
                                RoundedCornerShape(
                                    topStart = 18.dp,
                                    topEnd = 18.dp,
                                    bottomStart = if (isUser) 18.dp else 5.dp,
                                    bottomEnd = if (isUser) 5.dp else 18.dp
                                )
                            )
                            .combinedClickable(
                                onClick = {
                                    if (!resolvedMediaUrl.isNullOrBlank()) {
                                        onToggleVoice(resolvedMediaUrl)
                                    }
                                },
                                onLongClick = { showMenu = true }
                            )
                    ) {
                        Column(modifier = Modifier.padding(horizontal = 13.dp, vertical = 10.dp)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
                            ) {
                                if (isBufferingVoice) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(16.dp),
                                        strokeWidth = 1.8.dp,
                                        color = if (isUser) palette.userBubbleText else MaterialTheme.colorScheme.primary
                                    )
                                } else {
                                    Icon(
                                        imageVector = if (isPlayingVoice) Icons.Outlined.GraphicEq else Icons.AutoMirrored.Outlined.VolumeUp,
                                        contentDescription = "播放语音",
                                        tint = if (isUser) palette.userBubbleText else MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(19.dp)
                                    )
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "${dur}″",
                                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                                    color = if (isUser) palette.userBubbleText else palette.assistantBubbleText
                                )
                                if (isPlayingVoice) {
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = "播放中",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = if (isUser) palette.userBubbleText.copy(alpha = 0.8f) else MaterialTheme.colorScheme.primary
                                    )
                                }
                            }

                            if (dto.content.isNotBlank()) {
                                Spacer(modifier = Modifier.height(5.dp))
                                Text(
                                    text = dto.content,
                                    style = MaterialTheme.typography.labelMedium.copy(lineHeight = 18.sp),
                                    color = if (isUser) {
                                        palette.userBubbleText.copy(alpha = 0.85f)
                                    } else {
                                        palette.narrationText
                                    }
                                )
                            }
                        }
                    }
                }

                // 4. 剧场模式文学书页卡片排版
                isLiteraryScene -> {
                    Surface(
                        shape = RoundedCornerShape(18.dp),
                        color = palette.scenePaperBg,
                        border = BorderStroke(0.8.dp, palette.assistantBubbleBorder),
                        modifier = Modifier
                            .widthIn(max = 315.dp)
                            .clip(RoundedCornerShape(18.dp))
                            .combinedClickable(
                                onClick = {},
                                onLongClick = { showMenu = true }
                            )
                    ) {
                        Row(modifier = Modifier.height(IntrinsicSize.Min)) {
                            Box(
                                modifier = Modifier
                                    .width(3.5.dp)
                                    .fillMaxHeight()
                                    .background(palette.sceneAccentLine)
                            )
                            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp)) {
                                if (!item.quotedSummary.isNullOrBlank()) {
                                    QuotedSnippetBlock(
                                        text = item.quotedSummary,
                                        isInsideUserBubble = false
                                    )
                                    Spacer(modifier = Modifier.height(6.dp))
                                }
                                Text(
                                    text = buildSceneAnnotatedText(
                                        raw = dto.content,
                                        dialogueColor = palette.assistantBubbleText,
                                        narrationColor = palette.narrationText
                                    ),
                                    style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 25.sp)
                                )
                            }
                        }
                    }
                }

                // 5. 标准静奢文字气泡
                else -> {
                    Surface(
                        shape = RoundedCornerShape(
                            topStart = 18.dp,
                            topEnd = 18.dp,
                            bottomStart = if (isUser) 18.dp else 5.dp,
                            bottomEnd = if (isUser) 5.dp else 18.dp
                        ),
                        color = if (isUser) palette.userBubbleBg else palette.assistantBubbleBg,
                        border = if (isUser) null else BorderStroke(0.8.dp, palette.assistantBubbleBorder),
                        modifier = Modifier
                            .widthIn(max = 288.dp)
                            .clip(
                                RoundedCornerShape(
                                    topStart = 18.dp,
                                    topEnd = 18.dp,
                                    bottomStart = if (isUser) 18.dp else 5.dp,
                                    bottomEnd = if (isUser) 5.dp else 18.dp
                                )
                            )
                            .combinedClickable(
                                onClick = {},
                                onLongClick = { showMenu = true }
                            )
                    ) {
                        Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                            if (!item.quotedSummary.isNullOrBlank()) {
                                QuotedSnippetBlock(
                                    text = item.quotedSummary,
                                    isInsideUserBubble = isUser
                                )
                                Spacer(modifier = Modifier.height(6.dp))
                            }
                            Text(
                                text = dto.content,
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (isUser) palette.userBubbleText else palette.assistantBubbleText
                            )
                        }
                    }
                }
            }

            // 长按气泡菜单：复制文本 / 引用回复
            DropdownMenu(
                expanded = showMenu,
                onDismissRequest = { showMenu = false }
            ) {
                if (dto.content.isNotBlank()) {
                    DropdownMenuItem(
                        text = { Text("复制文本") },
                        leadingIcon = {
                            Icon(imageVector = Icons.Outlined.ContentCopy, contentDescription = null)
                        },
                        onClick = {
                            showMenu = false
                            clipboard.setText(AnnotatedString(dto.content))
                            onCopiedToast()
                        }
                    )
                }
                if (dto.id > 0L) {
                    DropdownMenuItem(
                        text = { Text("引用回复") },
                        leadingIcon = {
                            Icon(imageVector = Icons.AutoMirrored.Outlined.Reply, contentDescription = null)
                        },
                        onClick = {
                            showMenu = false
                            onQuoteMessage(dto)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun QuotedSnippetBlock(
    text: String,
    isInsideUserBubble: Boolean
) {
    val palette = LocalInkAndKinPalette.current
    val bg = if (isInsideUserBubble) {
        Color.White.copy(alpha = 0.12f)
    } else {
        palette.chipBg.copy(alpha = 0.65f)
    }
    val fg = if (isInsideUserBubble) {
        palette.userBubbleText.copy(alpha = 0.85f)
    } else {
        palette.narrationText
    }

    Surface(
        shape = RoundedCornerShape(8.dp),
        color = bg
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = fg,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp)
        )
    }
}

@Composable
private fun VoiceRecordingOverlay(
    amplitude: Float,
    elapsedSeconds: Int,
    isCancelState: Boolean,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(24.dp),
        color = Color(0xE6221F1C),
        shadowElevation = 8.dp,
        modifier = modifier.size(width = 178.dp, height = 156.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = String.format("%02d:%02d", elapsedSeconds / 60, elapsedSeconds % 60),
                style = MaterialTheme.typography.titleMedium,
                color = Color(0xFFFAF8F5)
            )

            // 动态麦克风音量柱
            Row(
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.height(46.dp)
            ) {
                val weights = listOf(0.45f, 0.75f, 1.0f, 0.85f, 0.55f, 0.9f, 0.5f)
                weights.forEach { factor ->
                    val barH = (10f + 34f * (amplitude * factor).coerceIn(0.1f, 1f)).dp
                    Box(
                        modifier = Modifier
                            .width(5.dp)
                            .height(barH)
                            .clip(RoundedCornerShape(999.dp))
                            .background(
                                if (isCancelState) Color(0xFFE57365) else Color(0xFFDCC0A8)
                            )
                    )
                }
            }

            Text(
                text = if (isCancelState) "松开手指，取消发送" else "手指上滑，取消发送",
                style = MaterialTheme.typography.labelMedium,
                color = if (isCancelState) Color(0xFFFF9A8D) else Color(0xFFD2C8BE)
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ScenePickerBottomSheet(
    scenesState: ScenesResponseDto?,
    isLoading: Boolean,
    currentSceneId: Int?,
    onDismiss: () -> Unit,
    onSelectDaily: () -> Unit,
    onSelectScene: (Int, String) -> Unit
) {
    val palette = LocalInkAndKinPalette.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = palette.pageBg
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "选择对话与剧场模式",
                    style = MaterialTheme.typography.titleLarge
                )
                if (isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp
                    )
                }
            }

            // 日常与已保存的场景各有独立上下文。
            val isPlainDaily = currentSceneId == null
            SceneOptionCard(
                title = "日常对话",
                subtitle = "自然轻快的即时聊天节奏，如同手机通讯软件面对面闲聊",
                selected = isPlainDaily,
                onClick = onSelectDaily
            )

            val scenes = scenesState?.scenes.orEmpty()
            if (scenes.isNotEmpty()) {
                HorizontalDivider(color = palette.cardBorder)
                Text(
                    text = "已创建的专属剧场",
                    style = MaterialTheme.typography.labelLarge,
                    color = palette.subtleText
                )
                scenes.forEach { scene ->
                    val metaLine = listOfNotNull(
                        scene.location?.takeIf { it.isNotBlank() },
                        scene.timeOfDay?.takeIf { it.isNotBlank() }
                    ).joinToString(" · ")
                    val desc = buildString {
                        if (metaLine.isNotEmpty()) append(metaLine)
                        if (!scene.description.isNullOrBlank()) {
                            if (isNotEmpty()) append("\n")
                            append(scene.description)
                        }
                    }.ifBlank { "进入此剧场展开沉浸互动" }

                    SceneOptionCard(
                        title = scene.title,
                        subtitle = desc,
                        selected = currentSceneId == scene.id,
                        onClick = { onSelectScene(scene.id, scene.title) }
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))
        }
    }
}

@Composable
private fun SceneOptionCard(
    title: String,
    subtitle: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    val palette = LocalInkAndKinPalette.current
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f) else palette.cardBg,
        border = BorderStroke(
            width = if (selected) 1.3.dp else 0.8.dp,
            color = if (selected) MaterialTheme.colorScheme.primary else palette.cardBorder
        ),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 15.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium
                    )
                )
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.labelMedium.copy(lineHeight = 18.sp),
                    color = palette.narrationText,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (selected) {
                Spacer(modifier = Modifier.width(10.dp))
                Icon(
                    imageVector = Icons.Outlined.Check,
                    contentDescription = "当前选中",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

@Composable
private fun FullscreenImageDialog(
    imageUrl: String,
    onDismiss: () -> Unit
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val transformState = rememberTransformableState { zoomChange, panChange, _ ->
        val newScale = (scale * zoomChange).coerceIn(1f, 4f)
        scale = newScale
        offset = if (newScale <= 1.02f) {
            Offset.Zero
        } else {
            offset + panChange
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xF20D0E10))
                .clickable { onDismiss() },
            contentAlignment = Alignment.Center
        ) {
            AsyncImage(
                model = imageUrl,
                contentDescription = "大图预览",
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer(
                        scaleX = scale,
                        scaleY = scale,
                        translationX = offset.x,
                        translationY = offset.y
                    )
                    .transformable(state = transformState)
            )

            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .statusBarsPadding()
                    .padding(14.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Close,
                    contentDescription = "关闭大图",
                    tint = Color.White
                )
            }
        }
    }
}

private fun looksLikeSceneNarration(text: String): Boolean {
    if (text.length >= 110 && text.contains('\n')) return true
    return Regex("(\\*[^*]+\\*|（[^）]{4,}）|\\([^)]{6,}\\))").containsMatchIn(text)
}

/**
 * 将剧场文本中的 *动作描写* / （神态旁白） 与人物对白区分着色排版
 */
private fun buildSceneAnnotatedText(
    raw: String,
    dialogueColor: Color,
    narrationColor: Color
): AnnotatedString {
    val tokenRegex = Regex("(\\*[^*]+\\*|（[^）]+）|\\([^)]+\\))")
    return buildAnnotatedString {
        var cursor = 0
        for (match in tokenRegex.findAll(raw)) {
            if (match.range.first > cursor) {
                withStyle(SpanStyle(color = dialogueColor)) {
                    append(raw.substring(cursor, match.range.first))
                }
            }
            val cleaned = match.value.trim('*')
            withStyle(SpanStyle(color = narrationColor, fontStyle = FontStyle.Italic)) {
                append(cleaned)
            }
            cursor = match.range.last + 1
        }
        if (cursor < raw.length) {
            withStyle(SpanStyle(color = dialogueColor)) {
                append(raw.substring(cursor))
            }
        }
    }
}
