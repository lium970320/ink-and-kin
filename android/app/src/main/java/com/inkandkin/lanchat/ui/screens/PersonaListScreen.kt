package com.inkandkin.lanchat.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.inkandkin.lanchat.data.UrlResolver
import com.inkandkin.lanchat.model.ConnectionState
import com.inkandkin.lanchat.model.PersonaSummaryDto
import com.inkandkin.lanchat.ui.InkAndKinUiState
import com.inkandkin.lanchat.ui.theme.LocalInkAndKinPalette
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun PersonaListScreen(
    state: InkAndKinUiState,
    onSelectPersona: (Int) -> Unit,
    onRefresh: () -> Unit,
    onOpenSettings: () -> Unit
) {
    val palette = LocalInkAndKinPalette.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.pageBg)
    ) {
        // 顶部静奢导航栏
        Surface(
            color = palette.barBg,
            shadowElevation = 0.5.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 18.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "书中人",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    LanStatusPill(
                        connectionState = state.connectionState,
                        onClick = onOpenSettings
                    )
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onRefresh) {
                        if (state.isLoadingPersonas) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.primary
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Outlined.Refresh,
                                contentDescription = "刷新列表",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(
                            imageVector = Icons.Outlined.Settings,
                            contentDescription = "连接与通知设置",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }

        if (state.personas.isEmpty() && !state.isLoadingPersonas) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "暂无角色或正在等待台式机响应",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "确认电脑上的书中人 正在运行后，点击右上角刷新即可同步角色列表",
                        style = MaterialTheme.typography.bodyMedium,
                        color = palette.subtleText
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .navigationBarsPadding(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(state.personas, key = { it.id }) { persona ->
                    val isTyping = state.typingByPersona[persona.id] == true
                    val activeSceneTitle = state.activeSceneTitleByPersona.getOrDefault(persona.id, persona.activeSceneTitle)
                    PersonaCard(
                        baseUrl = state.baseUrl,
                        persona = persona,
                        isTyping = isTyping,
                        activeSceneTitle = activeSceneTitle,
                        onClick = { onSelectPersona(persona.id) }
                    )
                }
            }
        }
    }
}

@Composable
fun LanStatusPill(
    connectionState: ConnectionState,
    onClick: () -> Unit
) {
    val palette = LocalInkAndKinPalette.current
    val (dotColor, label) = when (connectionState) {
        ConnectionState.CONNECTED -> palette.onlineDot to "局域网在线"
        ConnectionState.CONNECTING -> palette.warningDot to "重连中…"
        ConnectionState.AUTH_EXPIRED -> MaterialTheme.colorScheme.error to "需重连"
        ConnectionState.DISCONNECTED -> palette.warningDot to "等待连接"
    }

    Surface(
        shape = RoundedCornerShape(999.dp),
        color = palette.chipBg,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.5.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(dotColor)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = palette.chipContent
            )
        }
    }
}

@Composable
private fun PersonaCard(
    baseUrl: String,
    persona: PersonaSummaryDto,
    isTyping: Boolean,
    activeSceneTitle: String?,
    onClick: () -> Unit
) {
    val palette = LocalInkAndKinPalette.current
    val resolvedAvatar = UrlResolver.resolveMediaUrl(baseUrl, persona.avatarUrl)

    Surface(
        shape = RoundedCornerShape(20.dp),
        color = palette.cardBg,
        border = BorderStroke(0.8.dp, palette.cardBorder),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 15.dp, vertical = 14.dp),
            verticalAlignment = Alignment.Top
        ) {
            PersonaAvatar(
                avatarUrl = resolvedAvatar,
                name = persona.name,
                sizeDp = 56
            )

            Spacer(modifier = Modifier.width(14.dp))

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(5.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(
                            text = persona.name,
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (!persona.emotionalState.isNullOrBlank()) {
                            Spacer(modifier = Modifier.width(8.dp))
                            Surface(
                                shape = RoundedCornerShape(999.dp),
                                color = palette.chipBg
                            ) {
                                Text(
                                    text = persona.emotionalState,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = palette.chipContent,
                                    maxLines = 1,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                                )
                            }
                        }
                    }

                    val timeStr = formatFriendlyTimestamp(persona.lastMessageAt)
                    if (timeStr.isNotEmpty()) {
                        Text(
                            text = timeStr,
                            style = MaterialTheme.typography.labelMedium,
                            color = palette.subtleText
                        )
                    }
                }

                // 场景胶囊与亲密度标签行
                val hasSceneBadge = !activeSceneTitle.isNullOrBlank()
                val hasIntimacy = !persona.intimacyLevel.isNullOrBlank() || persona.intimacyScore != null
                if (hasSceneBadge || hasIntimacy || !persona.relationshipDesc.isNullOrBlank()) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        if (hasSceneBadge) {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = palette.scenePaperBg,
                                border = BorderStroke(0.6.dp, palette.sceneAccentLine.copy(alpha = 0.45f))
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.5.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = Icons.Outlined.AutoStories,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(12.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = "剧场 · $activeSceneTitle",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.primary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }

                        val relLabel = buildString {
                            if (!persona.relationshipDesc.isNullOrBlank()) append(persona.relationshipDesc)
                            if (!persona.intimacyLevel.isNullOrBlank()) {
                                if (isNotEmpty()) append(" · ")
                                append(persona.intimacyLevel)
                            } else if (persona.intimacyScore != null) {
                                if (isNotEmpty()) append(" · ")
                                append("亲密度 ${persona.intimacyScore.toInt()}")
                            }
                        }
                        if (relLabel.isNotBlank()) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = Icons.Outlined.FavoriteBorder,
                                    contentDescription = null,
                                    tint = palette.subtleText,
                                    modifier = Modifier.size(12.dp)
                                )
                                Spacer(modifier = Modifier.width(3.dp))
                                Text(
                                    text = relLabel,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = palette.subtleText,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }
                }

                // 作息摘要
                if (!persona.scheduleSummary.isNullOrBlank()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Outlined.Schedule,
                            contentDescription = null,
                            tint = palette.subtleText,
                            modifier = Modifier.size(13.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = persona.scheduleSummary,
                            style = MaterialTheme.typography.labelMedium,
                            color = palette.narrationText,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                // 最新消息预览
                Text(
                    text = when {
                        isTyping -> "对方正在输入…"
                        !persona.lastMessagePreview.isNullOrBlank() -> persona.lastMessagePreview
                        else -> "点击开始直连对话"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isTyping) MaterialTheme.colorScheme.primary else palette.subtleText,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
fun PersonaAvatar(
    avatarUrl: String?,
    name: String,
    sizeDp: Int
) {
    val palette = LocalInkAndKinPalette.current
    val initial = name.trim().firstOrNull()?.toString() ?: "M"

    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primaryContainer,
        border = BorderStroke(0.8.dp, palette.cardBorder),
        modifier = Modifier.size(sizeDp.dp)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = initial,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
            if (!avatarUrl.isNullOrBlank()) {
                AsyncImage(
                    model = avatarUrl,
                    contentDescription = name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxSize()
                        .clip(CircleShape)
                )
            }
        }
    }
}

fun formatFriendlyTimestamp(isoString: String?): String {
    if (isoString.isNullOrBlank()) return ""
    return runCatching {
        val instant = Instant.parse(isoString.trim())
        val zone = ZoneId.systemDefault()
        val zdt = instant.atZone(zone)
        val today = LocalDate.now(zone)
        if (zdt.toLocalDate() == today) {
            zdt.format(DateTimeFormatter.ofPattern("HH:mm"))
        } else {
            zdt.format(DateTimeFormatter.ofPattern("MM-dd"))
        }
    }.getOrDefault("")
}
