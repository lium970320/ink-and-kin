package com.inkandkin.lanchat.data

import android.net.Uri
import com.inkandkin.lanchat.model.MobilePingDto
import com.inkandkin.lanchat.model.MobileServerKind
import com.inkandkin.lanchat.model.UdpDiscoverResponseDto
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

data class PairDeepLinkPayload(val serverUrl: String, val code: String, val kind: MobileServerKind)

object MobileProtocol {
    const val VERSION = 1
    private val mirraiVersion = Regex("1\\.[0-9]+(?:\\.[0-9]+)?")

    fun recognizePing(payload: MobilePingDto): MobileServerKind? {
        if (!payload.ok) return null
        val kind = MobileServerKind.fromService(payload.service) ?: return null
        val supported = when (kind) {
            MobileServerKind.INK_AND_KIN -> payload.protocolVersion == VERSION
            MobileServerKind.MIRRAI -> payload.version?.matches(mirraiVersion) == true &&
                (payload.protocolVersion == null || payload.protocolVersion == VERSION)
        }
        return kind.takeIf { supported }
    }

    fun recognizeDiscovery(payload: UdpDiscoverResponseDto, senderPort: Int): MobileServerKind? {
        val kind = MobileServerKind.fromService(payload.service) ?: return null
        if (senderPort != kind.discoveryPort || payload.port !in 1..65535) return null
        val supported = when (kind) {
            MobileServerKind.INK_AND_KIN -> payload.protocolVersion == VERSION
            MobileServerKind.MIRRAI -> payload.protocolVersion == null || payload.protocolVersion == VERSION
        }
        return kind.takeIf { supported }
    }
}

object UrlResolver {
    private fun isLanHost(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".local")) return true
        if (host.contains(':')) {
            return host == "::1" || host.startsWith("fc") || host.startsWith("fd") ||
                listOf("fe8", "fe9", "fea", "feb").any { host.startsWith(it) }
        }
        val octets = host.split('.').map { it.toIntOrNull() ?: return false }
        if (octets.size != 4 || octets.any { it !in 0..255 }) return false
        val first = octets[0]
        val second = octets[1]
        return first == 10 || first == 127 || (first == 172 && second in 16..31) ||
            (first == 192 && second == 168) || (first == 169 && second == 254) ||
            (first == 100 && second in 64..127)
    }

    private fun isAllowedHttpUrl(url: HttpUrl): Boolean =
        url.username.isEmpty() && url.password.isEmpty() && (url.isHttps || isLanHost(url.host))

    fun normalizeBaseUrl(rawInput: String): String {
        val input = rawInput.trim()
        val hasScheme = input.contains("://")
        val text = if (hasScheme) input else "http://$input"
        val http = text.toHttpUrlOrNull() ?: return ""
        if (!isAllowedHttpUrl(http) || http.encodedPath != "/" || http.encodedQuery != null || http.fragment != null) return ""
        val explicitPort = Uri.parse(text).port != -1
        val normalized = if (!hasScheme && !explicitPort) http.newBuilder().port(3000).build() else http
        return normalized.toString().trimEnd('/')
    }

    fun hasSameOrigin(left: HttpUrl, right: HttpUrl): Boolean =
        left.scheme == right.scheme && left.host == right.host && left.port == right.port

    fun resolveMediaUrl(baseUrl: String, mediaUrl: String?): String? {
        val raw = mediaUrl?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val base = normalizeBaseUrl(baseUrl).toHttpUrlOrNull() ?: return null
        val resolved = base.resolve(raw) ?: return null
        if (!isAllowedHttpUrl(resolved) || (!resolved.isHttps && !hasSameOrigin(base, resolved))) return null
        return resolved.toString()
    }

    fun buildWebSocketUrl(baseUrl: String): String {
        val base = normalizeBaseUrl(baseUrl)
        val wsBase = if (base.startsWith("https://")) "wss://" + base.removePrefix("https://")
            else "ws://" + base.removePrefix("http://")
        return "$wsBase/api/mobile/ws"
    }

    fun buildApkDownloadUrl(baseUrl: String, customUrl: String?): String? {
        val base = normalizeBaseUrl(baseUrl).toHttpUrlOrNull() ?: return null
        val download = base.resolve(customUrl?.takeIf { it.isNotBlank() } ?: "/api/mobile/download/apk") ?: return null
        return download.toString().takeIf { isAllowedHttpUrl(download) && hasSameOrigin(base, download) }
    }

    fun parsePairDeepLink(uri: Uri?): PairDeepLinkPayload? {
        if (uri == null || !uri.isHierarchical || uri.host != "pair") return null
        val kind = MobileServerKind.fromService(uri.scheme) ?: return null
        val server = normalizeBaseUrl(uri.getQueryParameter("url").orEmpty())
        val code = uri.getQueryParameter("code").orEmpty()
        if (server.isEmpty() || !code.matches(Regex("[0-9]{6}"))) return null
        return PairDeepLinkPayload(server, code, kind)
    }

    fun parsePairDeepLink(raw: String?): PairDeepLinkPayload? =
        raw?.let { parsePairDeepLink(Uri.parse(it.trim())) }
}
