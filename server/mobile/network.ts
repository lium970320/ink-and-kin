import dgram from "node:dgram";
import { statSync } from "node:fs";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import {
  MOBILE_DISCOVERY_PORT, MOBILE_DISCOVERY_REQUEST, MOBILE_PAIR_SCHEME,
  MOBILE_PROTOCOL_VERSION, MOBILE_SERVICE,
} from "../../shared/mobile";
import { ENV } from "../_core/env";

export const mobileIdentity = { service: MOBILE_SERVICE, protocolVersion: MOBILE_PROTOCOL_VERSION };
export const apkFileName = "ink-and-kin-lan-chat.apk";
const apkDownloadUrl = "/api/mobile/download/apk";

let mobileHttpPort = 3000;

export function setMobileHttpPort(port: number) {
  mobileHttpPort = port;
}

export function isLocalIPv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168) || (first === 169 && second === 254);
}

export function getMobileNetwork() {
  const listenHost = ENV.listenHost;
  const wildcard = listenHost === "0.0.0.0" || listenHost === "::";
  const isLanListening = wildcard || isLocalIPv4(listenHost);
  const lanUrls = !ENV.mobileEnabled || !isLanListening ? [] :
    Array.from(new Set(Object.values(networkInterfaces()).flatMap(interfaces => (interfaces ?? [])
      .filter(info => !info.internal && (wildcard || info.address === listenHost) && isLocalIPv4(info.address))
      .map(info => `http://${info.address}:${mobileHttpPort}`))));
  return {
    enabled: ENV.mobileEnabled,
    listenHost,
    isLanListening,
    port: mobileHttpPort,
    discoveryPort: MOBILE_DISCOVERY_PORT,
    lanUrls,
    primaryLanUrl: lanUrls[0] ?? null,
  };
}

export function pairLink(baseUrl: string, code: string) {
  return `${MOBILE_PAIR_SCHEME}?${new URLSearchParams({ url: baseUrl, code })}`;
}

export function getMobileApkInfo() {
  const apkPath = ENV.mobileApkPath ? path.resolve(ENV.mobileApkPath) : null;
  const stat = apkPath && path.extname(apkPath).toLowerCase() === ".apk"
    ? statSync(apkPath, { throwIfNoEntry: false }) : undefined;
  return {
    path: stat?.isFile() && stat.size > 0 ? apkPath : null,
    info: {
      available: !!(stat?.isFile() && stat.size > 0),
      fileName: apkFileName,
      downloadUrl: apkDownloadUrl,
      versionName: ENV.mobileApkVersion ?? null,
      versionCode: ENV.mobileApkVersionCode,
      sizeBytes: stat?.isFile() ? stat.size : 0,
      updatedAt: stat?.isFile() ? stat.mtime.toISOString() : null,
      sha256: null,
      notes: null,
    },
  };
}

/** Respond to discovery on the same local network using the actual HTTP port. */
export function startMobileDiscoveryServer() {
  const network = getMobileNetwork();
  if (!network.enabled || !network.isLanListening) return;
  const socket = dgram.createSocket("udp4");
  socket.on("error", error => {
    console.warn("[Mobile] LAN discovery unavailable:", error.message);
    socket.close();
  });
  const payload = Buffer.from(JSON.stringify({ ...mobileIdentity, port: network.port }));
  socket.on("message", (message, remote) => {
    if (!isLocalIPv4(remote.address) || message.toString("utf8") !== MOBILE_DISCOVERY_REQUEST) return;
    socket.send(payload, remote.port, remote.address);
  });
  socket.bind(MOBILE_DISCOVERY_PORT, isLocalIPv4(network.listenHost) ? network.listenHost : "0.0.0.0");
  socket.unref();
  return socket;
}
