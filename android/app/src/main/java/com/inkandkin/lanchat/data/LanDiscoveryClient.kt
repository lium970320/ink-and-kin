package com.inkandkin.lanchat.data

import android.content.Context
import android.net.wifi.WifiManager
import com.inkandkin.lanchat.model.DiscoveredServer
import com.inkandkin.lanchat.model.UdpDiscoverResponseDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
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
        coerceInputValues = true
    }

    /**
     * 在 UDP 30003 查找书中人实例，再用 HTTP ping 核对服务身份和版本。
     */
    suspend fun discoverServers(extraCandidates: List<String> = emptyList()): List<DiscoveredServer> =
        withContext(Dispatchers.IO) {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val multicastLock = wifiManager?.createMulticastLock("ink_and_kin_udp_discover")?.apply {
                setReferenceCounted(false)
                runCatching { acquire() }
            }

            val candidateUrls = LinkedHashSet<String>()
            extraCandidates.map { UrlResolver.normalizeBaseUrl(it) }
                .filter { it.isNotBlank() }
                .forEach { candidateUrls.add(it) }

            val udpOriginUrls = LinkedHashSet<String>()

            try {
                DatagramSocket().use { socket ->
                    socket.broadcast = true
                    socket.soTimeout = 350

                    val payload = MobileProtocol.DISCOVER_MAGIC.toByteArray(Charsets.UTF_8)
                    val targets = collectBroadcastAddresses()

                    repeat(2) { round ->
                        for (addr in targets) {
                            runCatching {
                                val packet = DatagramPacket(payload, payload.size, addr, MobileProtocol.DISCOVER_PORT)
                                socket.send(packet)
                            }
                        }
                        if (round == 0) {
                            runCatching { Thread.sleep(120) }
                        }
                    }

                    val deadline = System.currentTimeMillis() + 1400L
                    val buffer = ByteArray(4096)
                    while (System.currentTimeMillis() < deadline && udpOriginUrls.size < 12) {
                        val recv = DatagramPacket(buffer, buffer.size)
                        try {
                            socket.receive(recv)
                            val text = String(recv.data, recv.offset, recv.length, Charsets.UTF_8).trim()
                            val sender = recv.address as? Inet4Address ?: continue
                            val parsed = runCatching {
                                json.decodeFromString<UdpDiscoverResponseDto>(text)
                            }.getOrNull()

                            if (parsed == null || parsed.service != MobileProtocol.SERVICE ||
                                parsed.protocolVersion != MobileProtocol.VERSION || parsed.port !in 1..65535 ||
                                recv.port != MobileProtocol.DISCOVER_PORT || !isOnLocalSubnet(sender)
                            ) continue
                            // 回复里的 URL 由发包者提供。只探测本子网上实际发出回复的地址。
                            val direct = UrlResolver.normalizeBaseUrl("http://${sender.hostAddress}:${parsed.port}")
                            if (direct.isNotEmpty()) {
                                candidateUrls.add(direct)
                                udpOriginUrls.add(direct)
                            }
                        } catch (_: SocketTimeoutException) {
                            // 等待下一轮直到总窗口结束
                        } catch (_: Exception) {
                            break
                        }
                    }
                }
            } catch (_: Exception) {
                // 即使当前网络禁用了 UDP 广播，也不阻断手动候选测速
            } finally {
                runCatching {
                    if (multicastLock?.isHeld == true) multicastLock.release()
                }
            }

            if (candidateUrls.isEmpty()) return@withContext emptyList()

            coroutineScope {
                candidateUrls.map { url ->
                    async {
                        val latency = apiClient.ping(url)
                        DiscoveredServer(
                            baseUrl = url,
                            latencyMs = latency,
                            reachable = latency != null,
                            fromUdp = url in udpOriginUrls
                        )
                    }
                }.awaitAll()
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
