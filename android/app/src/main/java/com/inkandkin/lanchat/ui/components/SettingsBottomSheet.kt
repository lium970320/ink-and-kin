package com.inkandkin.lanchat.ui.components

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.inkandkin.lanchat.BuildConfig
import com.inkandkin.lanchat.data.SavedServer
import com.inkandkin.lanchat.data.UrlResolver
import com.inkandkin.lanchat.data.appLabel
import com.inkandkin.lanchat.model.DiscoveredServer
import com.inkandkin.lanchat.model.MobileServerKind
import com.inkandkin.lanchat.model.ProactiveTargetMode
import com.inkandkin.lanchat.ui.InkAndKinUiState
import com.inkandkin.lanchat.ui.theme.LocalInkAndKinPalette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsBottomSheet(
    state: InkAndKinUiState,
    onDismiss: () -> Unit,
    onSelectProactiveMode: (ProactiveTargetMode) -> Unit,
    onScanLan: () -> Unit,
    onSelectServer: (DiscoveredServer) -> Unit,
    onSelectSavedServer: (SavedServer) -> Unit,
    onAddServer: () -> Unit,
    onApplyManualUrl: (String) -> Unit,
    onToggleKeepAlive: (Boolean) -> Unit,
    onToggleAutoPlayVoice: (Boolean) -> Unit,
    onCheckVersion: () -> Unit,
    onLogout: () -> Unit
) {
    val context = LocalContext.current
    val palette = LocalInkAndKinPalette.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var editingUrl by remember(state.baseUrl) { mutableStateOf(state.baseUrl) }
    var confirmLogout by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        onCheckVersion()
    }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("解除此手机配对？") },
            text = { Text("退出后将断开当前局域网实时连接，之后可随时通过扫码或配对码重新连接。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmLogout = false
                        onDismiss()
                        onLogout()
                    }
                ) {
                    Text("确认解除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmLogout = false }) {
                    Text("取消")
                }
            }
        )
    }

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
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "连接与通知设置",
                        style = MaterialTheme.typography.titleLarge
                    )
                    Text(
                        text = "已登录：${state.user?.displayName ?: "书中人用户"} · ${state.baseUrl}",
                        style = MaterialTheme.typography.labelMedium,
                        color = palette.subtleText
                    )
                }
            }

            // 1. 主动消息投递策略
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = palette.cardBg,
                border = BorderStroke(0.8.dp, palette.cardBorder),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "角色主动消息投递策略",
                            style = MaterialTheme.typography.titleMedium
                        )
                        if (state.isSavingProactiveMode) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp
                            )
                        }
                    }

                    ProactiveTargetMode.entries.forEach { mode ->
                        val selected = state.proactiveMode == mode
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { onSelectProactiveMode(mode) }
                                .padding(vertical = 6.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = selected,
                                onClick = { onSelectProactiveMode(mode) }
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = mode.title,
                                    style = MaterialTheme.typography.bodyMedium.copy(
                                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
                                    )
                                )
                                Text(
                                    text = mode.subtitle,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = palette.subtleText
                                )
                            }
                        }
                    }
                }
            }

            // 2. 后台常驻与语音设置
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = palette.cardBg,
                border = BorderStroke(0.8.dp, palette.cardBorder),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                            Text(
                                text = "后台常驻接收主动问候",
                                style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium)
                            )
                            Text(
                                text = "锁屏或切到后台时保持局域网长连接，收到问候即时弹出系统通知",
                                style = MaterialTheme.typography.labelMedium,
                                color = palette.subtleText
                            )
                        }
                        Switch(
                            checked = state.keepAliveEnabled,
                            onCheckedChange = onToggleKeepAlive
                        )
                    }

                    HorizontalDivider(
                        modifier = Modifier.padding(vertical = 10.dp),
                        color = palette.cardBorder
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                            Text(
                                text = "自动播放角色语音回复",
                                style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium)
                            )
                            Text(
                                text = "停留在当前聊天页收到新语音气泡时自动顺序播放",
                                style = MaterialTheme.typography.labelMedium,
                                color = palette.subtleText
                            )
                        }
                        Switch(
                            checked = state.autoPlayVoice,
                            onCheckedChange = onToggleAutoPlayVoice
                        )
                    }
                }
            }

            // 3. 局域网 IP 重新扫描与切换
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = palette.cardBg,
                border = BorderStroke(0.8.dp, palette.cardBorder),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "局域网地址探测与切换",
                            style = MaterialTheme.typography.titleMedium
                        )
                        TextButton(onClick = onScanLan, enabled = !state.isScanningLan) {
                            Icon(
                                imageVector = Icons.Outlined.Refresh,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(if (state.isScanningLan) "扫描中…" else "重新扫描 IP")
                        }
                    }

                    SavedServerList(
                        servers = state.savedServers,
                        activeUrl = state.baseUrl,
                        activeKind = state.serverKind,
                        isBusy = state.isPairingBusy,
                        onSelect = onSelectSavedServer
                    )
                    TextButton(onClick = onAddServer, enabled = !state.isPairingBusy) {
                        Text("添加服务器")
                    }

                    state.discoveredServers.forEach { srv ->
                        val active = srv.baseUrl == state.baseUrl
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = if (active) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else palette.pageBg,
                            border = BorderStroke(0.7.dp, if (active) MaterialTheme.colorScheme.primary else palette.cardBorder),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { onSelectServer(srv) }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(text = listOfNotNull(srv.kind?.appLabel, srv.baseUrl).joinToString(" · "),
                                    style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    text = if (srv.reachable && srv.latencyMs != null) "${srv.latencyMs} ms" else "不可达",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (srv.reachable) palette.onlineDot else palette.subtleText
                                )
                            }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedTextField(
                            value = editingUrl,
                            onValueChange = { editingUrl = it },
                            singleLine = true,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.weight(1f)
                        )
                        OutlinedButton(
                            onClick = { onApplyManualUrl(editingUrl) },
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Text("切换")
                        }
                    }
                }
            }

            // 书中人服务器提供同一应用的安装包。
            if (state.serverKind == MobileServerKind.INK_AND_KIN) Surface(
                shape = RoundedCornerShape(18.dp),
                color = palette.cardBg,
                border = BorderStroke(0.8.dp, palette.cardBorder),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    val remoteVer = state.versionInfo
                    val hasNewer = remoteVer != null && remoteVer.versionCode > BuildConfig.VERSION_CODE

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = "安装包版本与更新",
                                style = MaterialTheme.typography.titleMedium
                            )
                            Text(
                                text = buildString {
                                    append("当前版本 v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                                    if (remoteVer != null) {
                                        append(" · 服务端 v${remoteVer.versionName}")
                                    }
                                },
                                style = MaterialTheme.typography.labelMedium,
                                color = palette.subtleText
                            )
                        }

                        TextButton(onClick = onCheckVersion, enabled = !state.isCheckingVersion) {
                            Icon(
                                imageVector = Icons.Outlined.SystemUpdate,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(if (state.isCheckingVersion) "检查中…" else "检查更新")
                        }
                    }

                    val apkUrl = UrlResolver.buildApkDownloadUrl(state.baseUrl, remoteVer?.downloadUrl)
                    Button(
                        onClick = {
                            val download = apkUrl ?: return@Button
                            runCatching {
                                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(download)).apply {
                                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                }
                                context.startActivity(intent)
                            }
                        },
                        enabled = apkUrl != null && remoteVer?.available == true,
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (hasNewer) MaterialTheme.colorScheme.primary else palette.chipBg,
                            contentColor = if (hasNewer) MaterialTheme.colorScheme.onPrimary else palette.chipContent
                        ),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Download,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (hasNewer) {
                                "发现新版本 v${remoteVer?.versionName} · 浏览器下载覆盖安装"
                            } else {
                                "从台式机下载最新 APK 安装包"
                            }
                        )
                    }
                }
            }

            // 5. 退出配对
            OutlinedButton(
                onClick = { confirmLogout = true },
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f)),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Outlined.Logout,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text("退出并解除配对")
            }

            Spacer(modifier = Modifier.height(12.dp))
        }
    }
}
