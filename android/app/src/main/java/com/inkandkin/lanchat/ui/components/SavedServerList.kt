package com.inkandkin.lanchat.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.inkandkin.lanchat.data.SavedServer
import com.inkandkin.lanchat.data.appLabel
import com.inkandkin.lanchat.model.MobileServerKind
import com.inkandkin.lanchat.ui.theme.LocalInkAndKinPalette

@Composable
fun SavedServerList(
    servers: List<SavedServer>,
    activeUrl: String = "",
    activeKind: MobileServerKind? = null,
    isBusy: Boolean = false,
    onSelect: (SavedServer) -> Unit
) {
    if (servers.isEmpty()) return
    val palette = LocalInkAndKinPalette.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        Text("已保存的服务器", style = MaterialTheme.typography.titleSmall)
        servers.forEach { server ->
            val isCurrent = server.baseUrl == activeUrl && server.kind == activeKind
            val shape = RoundedCornerShape(12.dp)
            Surface(
                shape = shape,
                color = palette.pageBg,
                border = BorderStroke(0.7.dp, palette.cardBorder),
                modifier = Modifier.fillMaxWidth().clip(shape)
                    .clickable(enabled = !isBusy && !isCurrent) { onSelect(server) }
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            listOfNotNull(server.kind.appLabel, server.accountName).joinToString(" · "),
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Text(server.baseUrl, style = MaterialTheme.typography.bodySmall, color = palette.subtleText)
                    }
                    if (isCurrent) Text("当前连接", style = MaterialTheme.typography.labelMedium, color = palette.onlineDot)
                }
            }
        }
    }
}
