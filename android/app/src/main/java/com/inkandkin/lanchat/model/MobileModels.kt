package com.inkandkin.lanchat.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlin.math.roundToInt

/**
 * 兼容服务端返回字符串或数字类型的可空字符串序列化器（如 intimacyLevel 可能是 "亲密" 或 3）
 */
object FlexibleNullableStringSerializer : KSerializer<String?> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("FlexibleNullableString", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): String? {
        if (decoder is JsonDecoder) {
            val el = decoder.decodeJsonElement()
            if (el is JsonNull) return null
            if (el is JsonPrimitive) return el.contentOrNull
        }
        return runCatching { decoder.decodeString() }.getOrNull()
    }

    override fun serialize(encoder: Encoder, value: String?) {
        if (value == null) encoder.encodeString("") else encoder.encodeString(value)
    }
}

/**
 * 兼容整数、浮点数或字符串形式的 Int?（例如 mediaDuration 返回 3.6 或 "4" 或 4）
 */
object FlexibleNullableIntSerializer : KSerializer<Int?> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("FlexibleNullableInt", PrimitiveKind.INT)

    override fun deserialize(decoder: Decoder): Int? {
        if (decoder is JsonDecoder) {
            val el = decoder.decodeJsonElement()
            if (el is JsonNull) return null
            if (el is JsonPrimitive) {
                el.intOrNull?.let { return it }
                el.doubleOrNull?.let { return it.roundToInt() }
                el.contentOrNull?.toDoubleOrNull()?.let { return it.roundToInt() }
            }
            return null
        }
        return runCatching { decoder.decodeInt() }.getOrNull()
    }

    override fun serialize(encoder: Encoder, value: Int?) {
        if (value != null) encoder.encodeInt(value)
    }
}

/**
 * 兼容整数或字符串形式的 Long（例如消息 ID）
 */
object FlexibleLongSerializer : KSerializer<Long> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("FlexibleLong", PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): Long {
        if (decoder is JsonDecoder) {
            val el = decoder.decodeJsonElement()
            if (el is JsonPrimitive) {
                el.longOrNull?.let { return it }
                el.contentOrNull?.toLongOrNull()?.let { return it }
            }
            return 0L
        }
        return runCatching { decoder.decodeLong() }.getOrDefault(0L)
    }

    override fun serialize(encoder: Encoder, value: Long) {
        encoder.encodeLong(value)
    }
}

@Serializable
data class UdpDiscoverResponseDto(
    val service: String = "",
    val protocolVersion: Int = 0,
    val port: Int = 3000,
    val lanUrls: List<String> = emptyList()
)

@Serializable
data class MobilePingDto(
    val ok: Boolean = false,
    val service: String = "",
    val protocolVersion: Int = 0
)

@Serializable
data class MobileUserDto(
    val id: Int = 0,
    val username: String = "",
    val name: String? = null
) {
    val displayName: String
        get() = name?.takeIf { it.isNotBlank() } ?: username.ifBlank { "已连接用户" }
}

@Serializable
data class PairExchangeRequestDto(
    val code: String,
    val deviceName: String
)

@Serializable
data class PasswordLoginRequestDto(
    val username: String,
    val password: String,
    val deviceName: String
)

@Serializable
data class AuthExchangeResponseDto(
    val ok: Boolean = true,
    val token: String = "",
    val deviceId: String = "",
    val user: MobileUserDto? = null,
    val error: String? = null,
    val message: String? = null
)

@Serializable
data class PersonaSummaryDto(
    val id: Int,
    val name: String = "未命名角色",
    val avatarUrl: String? = null,
    val relationshipDesc: String? = null,
    val emotionalState: String? = null,
    val intimacyScore: Double? = null,
    @Serializable(with = FlexibleNullableStringSerializer::class)
    val intimacyLevel: String? = null,
    @Serializable(with = FlexibleNullableIntSerializer::class)
    val activeSceneId: Int? = null,
    val activeSceneTitle: String? = null,
    val scheduleSummary: String? = null,
    val lastMessagePreview: String? = null,
    val lastMessageAt: String? = null,
    val immersiveDailyScene: Boolean = false
)

@Serializable
data class PersonasResponseDto(
    val personas: List<PersonaSummaryDto> = emptyList()
)

@Serializable
data class MobileMessageDto(
    @Serializable(with = FlexibleLongSerializer::class)
    val id: Long = 0L,
    val personaId: Int = 0,
    val role: String = "assistant",
    val content: String = "",
    val messageType: String = "text",
    val isSticker: Boolean = false,
    val mediaUrl: String? = null,
    @Serializable(with = FlexibleNullableIntSerializer::class)
    val mediaDuration: Int? = null,
    val emotionalState: String? = null,
    val channel: String = "mobile",
    @Serializable(with = FlexibleNullableIntSerializer::class)
    val sceneId: Int? = null,
    val mode: String = "daily",
    val excludedFromContext: Boolean = false,
    val createdAt: String = "",
    val clientMsgId: String? = null,
    val replyToMessageId: Long? = null,
    val turnId: String? = null
) {
    val isUser: Boolean get() = role.equals("user", ignoreCase = true)
    val isAssistant: Boolean get() = !isUser
    val isVoice: Boolean get() = messageType.equals("voice", ignoreCase = true)
    val isImage: Boolean get() = messageType.equals("image", ignoreCase = true) || isSticker
    val isSceneMode: Boolean get() = mode.equals("scene", ignoreCase = true)
}

@Serializable
data class MessagesPageResponseDto(
    val messages: List<MobileMessageDto> = emptyList(),
    val hasMore: Boolean = false,
    @Serializable(with = FlexibleNullableIntSerializer::class)
    val activeSceneId: Int? = null,
    val activeSceneTitle: String? = null,
    val immersiveDailyScene: Boolean? = null
)

@Serializable
data class SendTextRequestDto(
    val text: String,
    val clientMsgId: String? = null,
    val replyToMessageId: Long? = null
)

@Serializable
data class SendVoiceRequestDto(
    val audioBase64: String,
    val mimeType: String = "audio/mp4",
    val fileName: String = "voice.m4a",
    val durationSeconds: Int,
    val clientMsgId: String,
    val replyToMessageId: Long? = null
)

@Serializable
data class SendImageRequestDto(
    val imageBase64: String,
    val mimeType: String = "image/jpeg",
    val fileName: String = "photo.jpg",
    val caption: String? = null,
    val clientMsgId: String,
    val replyToMessageId: Long? = null
)

@Serializable
data class SceneItemDto(
    val id: Int,
    val title: String,
    val location: String? = null,
    val timeOfDay: String? = null,
    val description: String? = null
)

@Serializable
data class ScenesResponseDto(
    @Serializable(with = FlexibleNullableIntSerializer::class)
    val activeSceneId: Int? = null,
    val immersiveDailyScene: Boolean = false,
    val scenes: List<SceneItemDto> = emptyList()
)

@Serializable
data class MobileSettingsDto(
    val proactiveTargetMode: String = "mobile_first"
)

@Serializable
data class MobileVersionDto(
    val available: Boolean = true,
    val versionName: String = "1.0.0",
    val versionCode: Int = 1,
    val sizeBytes: Long = 0L,
    val sha256: String = "",
    val updatedAt: String = "",
    val downloadUrl: String? = null
)

enum class SendStatus {
    SENT,
    SENDING,
    FAILED
}

sealed interface RetryPayload {
    data class Text(
        val text: String,
        val clientMsgId: String,
        val replyToMessageId: Long?
    ) : RetryPayload

    data class Voice(
        val audioBase64: String,
        val durationSeconds: Int,
        val clientMsgId: String,
        val replyToMessageId: Long?
    ) : RetryPayload

    data class Image(
        val imageBase64: String,
        val mimeType: String,
        val fileName: String,
        val caption: String?,
        val clientMsgId: String,
        val replyToMessageId: Long?
    ) : RetryPayload
}

data class ChatMessageItem(
    val dto: MobileMessageDto,
    val sendStatus: SendStatus = SendStatus.SENT,
    val localPreviewUri: String? = null,
    val quotedSummary: String? = null,
    val createdLocalEpochMs: Long = System.currentTimeMillis(),
    val retryPayload: RetryPayload? = null
) {
    val id: Long get() = dto.id
}

data class DiscoveredServer(
    val baseUrl: String,
    val latencyMs: Long? = null,
    val reachable: Boolean = false,
    val fromUdp: Boolean = true
)

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    AUTH_EXPIRED
}

enum class ProactiveTargetMode(
    val wireValue: String,
    val title: String,
    val subtitle: String
) {
    MOBILE_FIRST(
        wireValue = "mobile_first",
        title = "手机直连优先",
        subtitle = "手机在线时发往本机，离线时自动回退至 QQ"
    ),
    BOTH(
        wireValue = "both",
        title = "双端同时投递",
        subtitle = "手机直连与 QQ 同时接收角色主动问候"
    ),
    QQ_FIRST(
        wireValue = "qq_first",
        title = "QQ 优先",
        subtitle = "优先发往 QQ，QQ 不可用时发往手机直连"
    ),
    MOBILE_ONLY(
        wireValue = "mobile_only",
        title = "仅发往手机直连",
        subtitle = "主动问候仅推送至手机，不向 QQ 发送"
    ),
    QQ_ONLY(
        wireValue = "qq_only",
        title = "仅发往 QQ",
        subtitle = "暂停向手机推送主动消息，仅保留手动对话"
    );

    companion object {
        fun fromWire(value: String?): ProactiveTargetMode {
            return entries.firstOrNull { it.wireValue.equals(value, ignoreCase = true) }
                ?: MOBILE_FIRST
        }
    }
}
