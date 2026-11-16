package com.inkandkin.lanchat.data

import android.content.Context
import android.net.wifi.WifiManager
import com.inkandkin.lanchat.model.DiscoveredServer
import com.inkandkin.lanchat.model.MobileServerKind
import com.inkandkin.lanchat.model.UdpDiscoverResponseDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

class LanDiscoveryClient(
    private val context: Context,
    private val apiClient: InkAndKinApiClient
) {
    private val json = Json {
        ignoreUnknownKeys = true
    }

    /**
     * 用各自的 UDP 端口探测，再用 HTTP 验证收到回复的地址与服务身份。
     */
    suspend fun discoverServers(extraCandidates: List<String> = emptyList()): List<DiscoveredServer> =
        withContext(Dispatchers.IO) {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val multicastLock = wifiManager?.createMulticastLock("ink_and_kin_udp_discover")?.apply {
                setReferenceCounted(false)
                runCatching { acquire() }
            }

            val manualUrls = extraCandidates.map { UrlResolver.normalizeBaseUrl(it) }
                .filter { it.isNotBlank() }
                .toSet()
            val udpOrigins = MobileServerKind.entries.associateWith { LinkedHashSet<String>() }

            try {
                DatagramSocket().use { socket ->
                    socket.broadcast = true
                    socket.soTimeout = 350

                    val targets = collectBroadcastAddresses()
                    val probes = MobileServerKind.entries.associateWith { it.discoveryRequest.toByteArray(Charsets.UTF_8) }

                    repeat(2) { round ->
                        for (addr in targets) {
                            for ((kind, payload) in probes) {
                                runCatching {
                                    val packet = DatagramPacket(payload, payload.size, addr, kind.discoveryPort)
                                    socket.send(packet)
                                }
                            }
                        }
                        if (round == 0) {
                            delay(120)
                        }
                    }

                    val start = System.nanoTime()
                    val buffer = ByteArray(4096)
                    while (System.nanoTime() - start < 1_400_000_000L && udpOrigins.values.any { it.size < 12 }) {
                        coroutineContext.ensureActive()
                        val recv = DatagramPacket(buffer, buffer.size)
                        try {
                            socket.receive(recv)
                            val text = String(recv.data, recv.offset, recv.length, Charsets.UTF_8).trim()
                            val sender = recv.address as? Inet4Address ?: continue
                            val parsed = runCatching {
                                json.decodeFromString<UdpDiscoverResponseDto>(text)
                            }.getOrNull() ?: continue

                            val kind = MobileProtocol.recognizeDiscovery(parsed, recv.port) ?: continue
                            val origins = udpOrigins.getValue(kind)
                            if (origins.size >= 12 || !isOnLocalSubnet(sender)) continue
                            // 回复里的 URL 由发包者提供。只探测本子网上实际发出回复的地址。
                            val direct = UrlResolver.normalizeBaseUrl("http://${sender.hostAddress}:${parsed.port}")
                            if (direct.isNotEmpty()) {
                                origins.add(direct)
                            }
                        } catch (_: SocketTimeoutException) {
                            // 等待下一轮直到总窗口结束
                        } catch (_: Exception) {
                            break
                        }
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // 即使当前网络禁用了 UDP 广播，也不阻断手动候选测速
            } finally {
                runCatching {
                    if (multicastLock?.isHeld == true) multicastLock.release()
                }
            }

            val candidates = (manualUrls + udpOrigins.values.flatten())

            coroutineScope {
                candidates.map { url ->
                    async {
                        val probe = apiClient.probe(url)
                        val fromUdp = probe?.kind?.let { url in udpOrigins.getValue(it) } == true
                        if (url !in manualUrls && !fromUdp) return@async null
                        DiscoveredServer(
                            baseUrl = url,
                            latencyMs = probe?.latencyMs,
                            reachable = probe != null,
                            fromUdp = fromUdp,
                            kind = probe?.kind
                        )
                    }
                }.awaitAll().filterNotNull()
            }.sortedWith(
                compareByDescending<DiscoveredServer> { it.reachable }
                    .thenBy { it.latencyMs ?: Long.MAX_VALUE }
                    .thenByDescending { it.fromUdp }
            )
        }

    private fun collectBroadcastAddresses(): List<InetAddress> {
        val result = LinkedHashSet<InetAddress>()
        runCatching {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces != null && interfaces.hasMoreElements()) {
                val nif = interfaces.nextElement()
                if (!nif.isUp || nif.isLoopback) continue
                for (ia in nif.interfaceAddresses) {
                    val addr = ia.address
                    val bcast = ia.broadcast
                    if (addr is Inet4Address && bcast != null) {
                        result.add(bcast)
                    }
                }
            }
        }
        runCatching {
            result.add(InetAddress.getByName("255.255.255.255"))
        }
        return result.toList()
    }

    private fun isOnLocalSubnet(address: Inet4Address): Boolean = runCatching {
        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return false
        val sender = address.address.fold(0) { value, octet -> (value shl 8) or (octet.toInt() and 255) }
        while (interfaces.hasMoreElements()) {
            val intf = interfaces.nextElement()
            if (!intf.isUp || intf.isLoopback) continue
            for (entry in intf.interfaceAddresses) {
                val local = entry.address as? Inet4Address ?: continue
                val prefix = entry.networkPrefixLength.toInt()
                if (prefix !in 1..32) continue
                val localInt = local.address.fold(0) { value, octet -> (value shl 8) or (octet.toInt() and 255) }
                val mask = -1 shl (32 - prefix)
                if ((localInt and mask) == (sender and mask)) return true
            }
        }
        false
    }.getOrDefault(false)
}
