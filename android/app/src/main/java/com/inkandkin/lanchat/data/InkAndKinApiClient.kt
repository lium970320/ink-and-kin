package com.inkandkin.lanchat.data

import android.net.Uri
import com.inkandkin.lanchat.model.AuthExchangeResponseDto
import com.inkandkin.lanchat.model.MessagesPageResponseDto
import com.inkandkin.lanchat.model.MobileMessageDto
import com.inkandkin.lanchat.model.MobilePingDto
import com.inkandkin.lanchat.model.MobileSettingsDto
import com.inkandkin.lanchat.model.MobileVersionDto
import com.inkandkin.lanchat.model.PairExchangeRequestDto
import com.inkandkin.lanchat.model.PasswordLoginRequestDto
import com.inkandkin.lanchat.model.PersonaSummaryDto
import com.inkandkin.lanchat.model.PersonasResponseDto
import com.inkandkin.lanchat.model.ScenesResponseDto
import com.inkandkin.lanchat.model.SendImageRequestDto
import com.inkandkin.lanchat.model.SendTextRequestDto
import com.inkandkin.lanchat.model.SendVoiceRequestDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class AuthExpiredException(message: String = "登录凭证已过期，请重新配对") : IOException(message)
class ApiRequestException(val statusCode: Int, message: String) : IOException(message)

class InkAndKinApiClient(private val sessionStore: SessionStore) {

    val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        encodeDefaults = true
        explicitNulls = false
        isLenient = true
    }

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    val mediaHttpClient: OkHttpClient = okHttpClient.newBuilder().addInterceptor { chain ->
        val media = chain.request()
        val builder = media.newBuilder().removeHeader("Authorization")
        val session = sessionStore.snapshot()
        val origin = session?.baseUrl?.toHttpUrlOrNull()
        if (session != null && origin != null && UrlResolver.hasSameOrigin(origin, media.url) &&
            media.url.encodedPath.startsWith("/uploads/")
        ) {
            builder.header("Authorization", "Bearer ${session.token}")
        }
        chain.proceed(builder.build())
    }.build()

    private val pingClient: OkHttpClient = okHttpClient.newBuilder()
        .connectTimeout(1600, TimeUnit.MILLISECONDS)
        .readTimeout(1800, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(false)
        .build()

    private val turnClient: OkHttpClient = okHttpClient.newBuilder()
        .readTimeout(180, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()

    /**
     * GET /api/mobile/ping 测速验活，返回耗时毫秒；不可达返回 null
     */
    suspend fun ping(serverUrl: String): Long? = withContext(Dispatchers.IO) {
        val base = UrlResolver.normalizeBaseUrl(serverUrl)
        if (base.isEmpty()) return@withContext null
        val start = System.nanoTime()
        return@withContext try {
            val req = Request.Builder()
                .url("$base/api/mobile/ping")
                .get()
                .build()
            pingClient.newCall(req).execute().use { resp ->
                val payload = if (resp.isSuccessful) {
                    json.decodeFromString<MobilePingDto>(resp.peekBody(16_384L).string())
                } else null
                if (payload?.ok == true && payload.service == MobileProtocol.SERVICE &&
                    payload.protocolVersion == MobileProtocol.VERSION
                ) {
                    ((System.nanoTime() - start) / 1_000_000L).coerceAtLeast(1L)
                } else {
                    null
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * POST /api/mobile/pair/exchange
     */
    suspend fun pairExchange(serverUrl: String, code: String, deviceName: String): AuthExchangeResponseDto =
        withContext(Dispatchers.IO) {
            val base = UrlResolver.normalizeBaseUrl(serverUrl)
            val bodyStr = json.encodeToString(
                PairExchangeRequestDto(code = code.trim(), deviceName = deviceName)
            )
            val raw = executeJson(
                url = "$base/api/mobile/pair/exchange",
                method = "POST",
                bodyJson = bodyStr,
                includeAuth = false
            )
            val parsed = json.decodeFromString<AuthExchangeResponseDto>(raw)
            if (!parsed.ok || parsed.token.isBlank()) {
                throw IOException(parsed.error ?: parsed.message ?: "配对码无效或已过期")
            }
            parsed
        }

    /**
     * POST /api/mobile/auth/login
     */
    suspend fun loginWithPassword(
        serverUrl: String,
        username: String,
        password: String,
        deviceName: String
    ): AuthExchangeResponseDto = withContext(Dispatchers.IO) {
        val base = UrlResolver.normalizeBaseUrl(serverUrl)
        val bodyStr = json.encodeToString(
            PasswordLoginRequestDto(
                username = username.trim(),
                password = password,
                deviceName = deviceName
            )
        )
        val raw = executeJson(
            url = "$base/api/mobile/auth/login",
            method = "POST",
            bodyJson = bodyStr,
            includeAuth = false
        )
        val parsed = json.decodeFromString<AuthExchangeResponseDto>(raw)
        if (!parsed.ok || parsed.token.isBlank()) {
            throw IOException(parsed.error ?: parsed.message ?: "用户名或密码错误")
        }
        parsed
    }

    /**
     * GET /api/mobile/personas
     */
    suspend fun getPersonas(): List<PersonaSummaryDto> = withContext(Dispatchers.IO) {
        val raw = executeJson("${requireBaseUrl()}/api/mobile/personas", "GET")
        val el = json.parseToJsonElement(raw)
        when (el) {
            is JsonArray -> json.decodeFromJsonElement<List<PersonaSummaryDto>>(el)
            is JsonObject -> json.decodeFromJsonElement<PersonasResponseDto>(el).personas
            else -> emptyList()
        }
    }

    /**
     * GET /api/mobile/personas/{id}/messages?limit=50&beforeId=...&afterId=...&scope=current
     */
    suspend fun getMessages(
        personaId: Int,
        limit: Int = 50,
        beforeId: Long? = null,
        afterId: Long? = null,
        scope: String = "current"
    ): MessagesPageResponseDto = withContext(Dispatchers.IO) {
        val uriBuilder = Uri.parse("${requireBaseUrl()}/api/mobile/personas/$personaId/messages")
            .buildUpon()
            .appendQueryParameter("limit", limit.toString())
            .appendQueryParameter("scope", scope)
        if (beforeId != null && beforeId > 0L) {
            uriBuilder.appendQueryParameter("beforeId", beforeId.toString())
        }
        if (afterId != null && afterId > 0L) {
            uriBuilder.appendQueryParameter("afterId", afterId.toString())
        }
        val raw = executeJson(uriBuilder.build().toString(), "GET")
        json.decodeFromString<MessagesPageResponseDto>(raw)
    }

    /**
     * POST /api/mobile/personas/{id}/messages/text
     * 返回响应中可能包含的服务端消息列表（兼容单条 message / userMessage / messages 数组）
     */
    suspend fun sendTextMessage(
        personaId: Int,
        text: String,
        clientMsgId: String?,
        replyToMessageId: Long?
    ): List<MobileMessageDto> = withContext(Dispatchers.IO) {
        val bodyStr = json.encodeToString(
            SendTextRequestDto(
                text = text,
                clientMsgId = clientMsgId,
                replyToMessageId = replyToMessageId?.takeIf { it > 0L }
            )
        )
        val raw = executeJson(
            url = "${requireBaseUrl()}/api/mobile/personas/$personaId/messages/text",
            method = "POST",
            bodyJson = bodyStr,
            client = turnClient
        )
        extractMessagesFromSendResponse(raw)
    }

    /**
     * POST /api/mobile/personas/{id}/messages/voice
     */
    suspend fun sendVoiceMessage(
        personaId: Int,
        audioBase64: String,
        durationSeconds: Int,
        clientMsgId: String,
        replyToMessageId: Long?
    ): List<MobileMessageDto> = withContext(Dispatchers.IO) {
        val bodyStr = json.encodeToString(
            SendVoiceRequestDto(
                audioBase64 = audioBase64,
                mimeType = "audio/mp4",
                fileName = "voice.m4a",
                durationSeconds = durationSeconds.coerceAtLeast(1),
                clientMsgId = clientMsgId,
                replyToMessageId = replyToMessageId?.takeIf { it > 0L }
            )
        )
        val raw = executeJson(
            url = "${requireBaseUrl()}/api/mobile/personas/$personaId/messages/voice",
            method = "POST",
            bodyJson = bodyStr,
            client = turnClient
        )
        extractMessagesFromSendResponse(raw)
    }

    /**
     * POST /api/mobile/personas/{id}/messages/image
     */
    suspend fun sendImageMessage(
        personaId: Int,
        imageBase64: String,
        mimeType: String = "image/jpeg",
        fileName: String = "photo.jpg",
        caption: String? = null,
        clientMsgId: String,
        replyToMessageId: Long?
    ): List<MobileMessageDto> = withContext(Dispatchers.IO) {
        val bodyStr = json.encodeToString(
            SendImageRequestDto(
                imageBase64 = imageBase64,
                mimeType = mimeType,
                fileName = fileName,
                caption = caption?.takeIf { it.isNotBlank() },
                clientMsgId = clientMsgId,
                replyToMessageId = replyToMessageId?.takeIf { it > 0L }
            )
        )
        val raw = executeJson(
            url = "${requireBaseUrl()}/api/mobile/personas/$personaId/messages/image",
            method = "POST",
            bodyJson = bodyStr,
            client = turnClient
        )
        extractMessagesFromSendResponse(raw)
    }

    /**
     * GET /api/mobile/personas/{id}/scenes
     */
    suspend fun getScenes(personaId: Int): ScenesResponseDto = withContext(Dispatchers.IO) {
        val raw = executeJson("${requireBaseUrl()}/api/mobile/personas/$personaId/scenes", "GET")
        json.decodeFromString<ScenesResponseDto>(raw)
    }

    /**
     * POST /api/mobile/personas/{id}/scene
     */
    suspend fun updateScene(
        personaId: Int,
        sceneId: Int?
    ): JsonObject = withContext(Dispatchers.IO) {
        val payload = buildJsonObject {
            if (sceneId == null) put("sceneId", JsonNull) else put("sceneId", sceneId)
        }
        val raw = executeJson(
            url = "${requireBaseUrl()}/api/mobile/personas/$personaId/scene",
            method = "POST",
            bodyJson = payload.toString()
        )
        runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: buildJsonObject {}
    }

    /**
     * POST /api/mobile/personas/{id}/reset-segment
     */
    suspend fun resetSegment(personaId: Int) = withContext(Dispatchers.IO) {
        executeJson(
            url = "${requireBaseUrl()}/api/mobile/personas/$personaId/reset-segment",
            method = "POST",
            bodyJson = "{}"
        )
    }

    /**
     * GET /api/mobile/settings
     */
    suspend fun getSettings(): MobileSettingsDto = withContext(Dispatchers.IO) {
        val raw = executeJson("${requireBaseUrl()}/api/mobile/settings", "GET")
        val obj = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
        val nested = obj?.get("settings") as? JsonObject
        if (nested != null) {
            json.decodeFromJsonElement<MobileSettingsDto>(nested)
        } else {
            json.decodeFromString<MobileSettingsDto>(raw)
        }
    }

    /**
     * PUT /api/mobile/settings
     */
    suspend fun updateSettings(proactiveTargetMode: String): MobileSettingsDto =
        withContext(Dispatchers.IO) {
            val bodyStr = json.encodeToString(MobileSettingsDto(proactiveTargetMode = proactiveTargetMode))
            val raw = executeJson(
                url = "${requireBaseUrl()}/api/mobile/settings",
                method = "PUT",
                bodyJson = bodyStr
            )
            val obj = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
            val nested = obj?.get("settings") as? JsonObject
            if (nested != null) {
                json.decodeFromJsonElement<MobileSettingsDto>(nested)
            } else {
                runCatching { json.decodeFromString<MobileSettingsDto>(raw) }
                    .getOrDefault(MobileSettingsDto(proactiveTargetMode = proactiveTargetMode))
            }
        }

    /**
     * GET /api/mobile/version
     */
    suspend fun getVersion(): MobileVersionDto = withContext(Dispatchers.IO) {
        val raw = executeJson(
            url = "${requireBaseUrl()}/api/mobile/version",
            method = "GET",
            includeAuth = false
        )
        val obj = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
        val nested = obj?.get("version") as? JsonObject
        if (nested != null) {
            json.decodeFromJsonElement<MobileVersionDto>(nested)
        } else {
            json.decodeFromString<MobileVersionDto>(raw)
        }
    }

    private fun extractMessagesFromSendResponse(raw: String): List<MobileMessageDto> {
        if (raw.isBlank()) return emptyList()
        val result = ArrayList<MobileMessageDto>()
        runCatching {
            val root = json.parseToJsonElement(raw)
            if (root is JsonObject) {
                listOf("userMessage", "message").forEach { key ->
                    val el = root[key]
                    if (el is JsonObject && el["id"] != null) {
                        runCatching { json.decodeFromJsonElement<MobileMessageDto>(el) }
                            .getOrNull()
                            ?.takeIf { it.id > 0L }
                            ?.let { result.add(it) }
                    }
                }
                val arr = root["messages"] as? JsonArray
                arr?.forEach { item ->
                    runCatching { json.decodeFromJsonElement<MobileMessageDto>(item) }
                        .getOrNull()
                        ?.takeIf { it.id > 0L }
                        ?.let { result.add(it) }
                }
                if (result.isEmpty() && root["id"] != null && root["role"] != null) {
                    runCatching { json.decodeFromJsonElement<MobileMessageDto>(root) }
                        .getOrNull()
                        ?.takeIf { it.id > 0L }
                        ?.let { result.add(it) }
                }
            }
        }
        return result.distinctBy { it.id }
    }

    private fun requireBaseUrl(): String {
        val base = UrlResolver.normalizeBaseUrl(sessionStore.baseUrl)
        if (base.isBlank()) throw IOException("尚未配置局域网服务端地址")
        return base
    }

    private fun executeJson(
        url: String,
        method: String,
        bodyJson: String? = null,
        includeAuth: Boolean = true,
        client: OkHttpClient = okHttpClient
    ): String {
        val target = url.toHttpUrlOrNull() ?: throw IOException("服务端地址无效")
        val reqBuilder = Request.Builder().url(target)
        if (includeAuth) {
            val session = sessionStore.snapshot() ?: throw IOException("请先配对或登录")
            val origin = session.baseUrl.toHttpUrlOrNull() ?: throw IOException("已登录地址无效")
            if (!UrlResolver.hasSameOrigin(origin, target)) throw IOException("服务器已切换，请重新登录")
            reqBuilder.header("Authorization", "Bearer ${session.token}")
        }
        reqBuilder.header("Accept", "application/json")
        when (method.uppercase()) {
            "GET" -> reqBuilder.get()
            "POST" -> reqBuilder.post((bodyJson ?: "{}").toRequestBody(JSON_MEDIA))
            "PUT" -> reqBuilder.put((bodyJson ?: "{}").toRequestBody(JSON_MEDIA))
            "DELETE" -> {
                if (bodyJson != null) reqBuilder.delete(bodyJson.toRequestBody(JSON_MEDIA))
                else reqBuilder.delete()
            }
            else -> throw IllegalArgumentException("Unsupported HTTP method: $method")
        }

        client.newCall(reqBuilder.build()).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (resp.code == 401) {
                throw AuthExpiredException(extractErrorMessage(text) ?: "配对状态已失效，请重新连接")
            }
            if (!resp.isSuccessful) {
                val msg = extractErrorMessage(text) ?: "请求失败 (HTTP ${resp.code})"
                throw ApiRequestException(resp.code, msg)
            }
            return text
        }
    }

    internal suspend fun revokeSession(session: MobileSession): Boolean = withContext(Dispatchers.IO) {
        val origin = session.baseUrl.toHttpUrlOrNull() ?: return@withContext false
        val endpoint = origin.newBuilder().encodedPath("/api/mobile/auth/logout").query(null).fragment(null).build()
        val request = Request.Builder().url(endpoint)
            .header("Authorization", "Bearer ${session.token}")
            .post("{}".toRequestBody(JSON_MEDIA))
            .build()
        val call = okHttpClient.newCall(request)
        call.timeout().timeout(5, TimeUnit.SECONDS)
        call.execute().use { response -> response.isSuccessful || response.code == 401 }
    }

    fun cancelPendingRequests() {
        okHttpClient.dispatcher.cancelAll()
    }

    private fun extractErrorMessage(raw: String): String? {
        if (raw.isBlank()) return null
        return runCatching {
            val el: JsonElement = json.parseToJsonElement(raw)
            if (el is JsonObject) {
                (el["error"] as? JsonPrimitive)?.contentOrNull
                    ?: (el["message"] as? JsonPrimitive)?.contentOrNull
            } else {
                null
            }
        }.getOrNull()?.takeIf { it.isNotBlank() }
    }
}
