package com.inkandkin.lanchat.data

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import com.inkandkin.lanchat.model.MobileMessageDto
import com.inkandkin.lanchat.model.MobileUserDto
import com.inkandkin.lanchat.model.PersonaSummaryDto
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

internal class MobileSession(val baseUrl: String, val token: String)

class SessionStore(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(
        "ink_and_kin_lan_session_v1",
        Context.MODE_PRIVATE
    )

    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        encodeDefaults = true
        explicitNulls = false
    }

    val baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, "") ?: ""

    val deviceId: String
        get() = prefs.getString(KEY_DEVICE_ID, "") ?: ""

    val user: MobileUserDto?
        get() {
            val raw = prefs.getString(KEY_USER_JSON, null) ?: return null
            return runCatching { json.decodeFromString<MobileUserDto>(raw) }.getOrNull()
        }

    var lastSelectedPersonaId: Int?
        get() {
            val v = prefs.getInt(KEY_LAST_PERSONA_ID, -1)
            return if (v > 0) v else null
        }
        set(value) {
            prefs.edit().putInt(KEY_LAST_PERSONA_ID, value ?: -1).apply()
        }

    var keepAliveEnabled: Boolean
        get() = prefs.getBoolean(KEY_KEEP_ALIVE, true)
        set(value) = prefs.edit().putBoolean(KEY_KEEP_ALIVE, value).apply()

    var autoPlayVoice: Boolean
        get() = prefs.getBoolean(KEY_AUTO_PLAY_VOICE, true)
        set(value) = prefs.edit().putBoolean(KEY_AUTO_PLAY_VOICE, value).apply()

    val isAuthenticated: Boolean
        get() = snapshot() != null

    internal fun snapshot(): MobileSession? {
        val values = prefs.all
        val origin = values[KEY_BASE_URL] as? String ?: return null
        val token = values[KEY_TOKEN] as? String ?: return null
        return if (origin.isNotBlank() && token.isNotBlank()) MobileSession(origin, token) else null
    }

    internal fun isCurrent(session: MobileSession): Boolean =
        snapshot()?.let { it.baseUrl == session.baseUrl && it.token == session.token } == true

    fun saveSession(
        serverUrl: String,
        jwtToken: String,
        assignedDeviceId: String,
        userInfo: MobileUserDto?
    ) {
        val url = UrlResolver.normalizeBaseUrl(serverUrl)
        require(url.isNotBlank() && jwtToken.isNotBlank())
        prefs.edit()
            .clearAccountData()
            .putString(KEY_BASE_URL, url)
            .putString(KEY_TOKEN, jwtToken.trim())
            .putString(KEY_DEVICE_ID, assignedDeviceId.trim())
            .apply {
                if (userInfo != null) {
                    putString(KEY_USER_JSON, json.encodeToString(userInfo))
                }
            }
            .apply()
    }

    fun clearAuthKeepServerUrl() = prefs.edit().clearAccountData().apply()

    private fun SharedPreferences.Editor.clearAccountData(): SharedPreferences.Editor {
        prefs.all.keys.filter { it.startsWith(KEY_CACHED_MESSAGES_PREFIX) }.forEach { remove(it) }
        return remove(KEY_TOKEN)
            .remove(KEY_DEVICE_ID)
            .remove(KEY_USER_JSON)
            .remove(KEY_LAST_PERSONA_ID)
            .remove(KEY_CACHED_PERSONAS)
    }

    fun saveCachedPersonas(personas: List<PersonaSummaryDto>) {
        if (!isAuthenticated) return
        runCatching {
            prefs.edit().putString(KEY_CACHED_PERSONAS, json.encodeToString(personas)).apply()
        }
    }

    fun loadCachedPersonas(): List<PersonaSummaryDto> {
        val raw = prefs.getString(KEY_CACHED_PERSONAS, null) ?: return emptyList()
        return runCatching { json.decodeFromString<List<PersonaSummaryDto>>(raw) }
            .getOrDefault(emptyList())
    }

    fun saveCachedMessages(personaId: Int, messages: List<MobileMessageDto>) {
        if (!isAuthenticated) return
        runCatching {
            val tail = messages.filter { it.id > 0L }.takeLast(60)
            prefs.edit().putString("$KEY_CACHED_MESSAGES_PREFIX$personaId", json.encodeToString(tail)).apply()
        }
    }

    fun loadCachedMessages(personaId: Int): List<MobileMessageDto> {
        val raw = prefs.getString("$KEY_CACHED_MESSAGES_PREFIX$personaId", null) ?: return emptyList()
        return runCatching { json.decodeFromString<List<MobileMessageDto>>(raw) }
            .getOrDefault(emptyList())
    }

    companion object {
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_TOKEN = "jwt_token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_USER_JSON = "user_json"
        private const val KEY_LAST_PERSONA_ID = "last_persona_id"
        private const val KEY_KEEP_ALIVE = "keep_alive_enabled"
        private const val KEY_AUTO_PLAY_VOICE = "auto_play_voice"
        private const val KEY_CACHED_PERSONAS = "cached_personas_v1"
        private const val KEY_CACHED_MESSAGES_PREFIX = "cached_messages_v1_"

        fun buildDeviceName(): String {
            val brand = Build.BRAND?.trim().orEmpty().replaceFirstChar {
                if (it.isLowerCase()) it.titlecase() else it.toString()
            }
            val model = Build.MODEL?.trim().orEmpty()
            return when {
                brand.isNotEmpty() && model.startsWith(brand, ignoreCase = true) -> model
                brand.isNotEmpty() && model.isNotEmpty() -> "$brand $model"
                model.isNotEmpty() -> model
                else -> "Android Phone"
            }
        }
    }
}
