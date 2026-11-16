package com.inkandkin.lanchat.data

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import com.inkandkin.lanchat.model.MobileMessageDto
import com.inkandkin.lanchat.model.MobileServerKind
import kotlinx.serialization.Serializable
import com.inkandkin.lanchat.model.MobileUserDto
import com.inkandkin.lanchat.model.PersonaSummaryDto
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

internal class MobileSession(
    val baseUrl: String,
    val token: String,
    val kind: MobileServerKind,
    val activation: Long
)

data class SavedServer(val baseUrl: String, val kind: MobileServerKind, val accountName: String?)

val MobileServerKind.appLabel: String
    get() = if (this == MobileServerKind.MIRRAI) "Mirrai" else "书中人"

@Serializable
private class StoredConnection(
    val baseUrl: String,
    val kindName: String,
    val token: String,
    val deviceId: String,
    val user: MobileUserDto?
) {
    val kind get() = runCatching { MobileServerKind.valueOf(kindName) }.getOrNull()
    val key get() = baseUrl to kindName
}

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

    private fun active(values: Map<String, *>): StoredConnection? {
        val origin = values[KEY_BASE_URL] as? String ?: return null
        val token = (values[KEY_TOKEN] as? String)?.takeIf { it.isNotBlank() } ?: return null
        if (origin.isBlank() || UrlResolver.normalizeBaseUrl(origin) != origin) return null
        val userInfo = (values[KEY_USER_JSON] as? String)?.let {
            runCatching { json.decodeFromString<MobileUserDto>(it) }.getOrNull()
        }
        return StoredConnection(origin, values[KEY_SERVER_KIND] as? String ?: MobileServerKind.INK_AND_KIN.name,
            token, values[KEY_DEVICE_ID] as? String ?: "", userInfo)
    }

    private fun connections(values: Map<String, *>): List<StoredConnection> {
        val saved = (values[KEY_CONNECTIONS] as? String)?.let {
            runCatching { json.decodeFromString<List<StoredConnection>>(it) }.getOrNull()
        }.orEmpty()
        // Include the active record so upgrades retain an existing single-server login.
        return (listOfNotNull(active(values)) + saved).filter {
            it.kind != null && it.token.isNotBlank() && it.baseUrl.isNotBlank() &&
                UrlResolver.normalizeBaseUrl(it.baseUrl) == it.baseUrl
        }.distinctBy { it.key }
    }

    fun savedServers(): List<SavedServer> = connections(prefs.all).mapNotNull { entry ->
        entry.kind?.let { SavedServer(entry.baseUrl, it, entry.user?.name?.takeIf(String::isNotBlank) ?: entry.user?.username) }
    }

    internal fun snapshot(): MobileSession? {
        val values = prefs.all
        val record = active(values) ?: return null
        return MobileSession(record.baseUrl, record.token, record.kind ?: return null, values[KEY_ACTIVATION] as? Long ?: 0L)
    }

    internal fun isCurrent(session: MobileSession): Boolean = snapshot()?.let {
        it.baseUrl == session.baseUrl && it.token == session.token &&
            it.kind == session.kind && it.activation == session.activation
    } == true

    @Synchronized
    fun saveSession(
        serverUrl: String,
        jwtToken: String,
        assignedDeviceId: String,
        userInfo: MobileUserDto?,
        kind: MobileServerKind
    ) {
        val url = UrlResolver.normalizeBaseUrl(serverUrl)
        require(url.isNotBlank() && jwtToken.isNotBlank())
        val entry = StoredConnection(url, kind.name, jwtToken.trim(), assignedDeviceId.trim(), userInfo)
        val values = prefs.all
        activate(url, entry, listOf(entry) + connections(values).filterNot { it.key == entry.key }, values)
    }

    @Synchronized
    fun selectServer(server: SavedServer): Boolean {
        val values = prefs.all
        val saved = connections(values)
        val entry = saved.firstOrNull { it.baseUrl == server.baseUrl && it.kind == server.kind } ?: return false
        activate(entry.baseUrl, entry, saved, values)
        return true
    }

    @Synchronized
    fun switchToPairing(nextUrl: String = "", forgetCurrent: Boolean = false) {
        val values = prefs.all
        val current = active(values)
        val saved = connections(values).filterNot { forgetCurrent && it.key == current?.key }
        activate(nextUrl, null, saved, values)
    }

    private fun activate(
        url: String, entry: StoredConnection?, saved: List<StoredConnection>, values: Map<String, *>
    ) {
        val editor = prefs.edit().clearAccountData()
            .putString(KEY_BASE_URL, UrlResolver.normalizeBaseUrl(url).takeIf { url.isNotBlank() } ?: "")
            .putLong(KEY_ACTIVATION, (values[KEY_ACTIVATION] as? Long ?: 0L) + 1L)
            .putString(KEY_CONNECTIONS, json.encodeToString(saved))
        if (entry != null) {
            editor.putString(KEY_TOKEN, entry.token).putString(KEY_DEVICE_ID, entry.deviceId)
                .putString(KEY_SERVER_KIND, entry.kindName)
            entry.user?.let { editor.putString(KEY_USER_JSON, json.encodeToString(it)) }
        }
        editor.apply()
    }

    private fun SharedPreferences.Editor.clearAccountData(): SharedPreferences.Editor {
        prefs.all.keys.filter { it.startsWith(KEY_CACHED_MESSAGES_PREFIX) }.forEach { remove(it) }
        return remove(KEY_TOKEN)
            .remove(KEY_DEVICE_ID)
            .remove(KEY_USER_JSON)
            .remove(KEY_SERVER_KIND)
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
        private const val KEY_SERVER_KIND = "server_kind"
        private const val KEY_ACTIVATION = "connection_activation"
        private const val KEY_CONNECTIONS = "saved_connections_v1"
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
