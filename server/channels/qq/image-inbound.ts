import { mimeFromBytes } from "./media-assets";

const QQ_IMAGE_HOSTS = new Set(["multimedia.nt.qq.com.cn", "gchat.qpic.cn", "c2cpicdw.qpic.cn"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export async function readQqInboundImage(raw: string | null, fetchImage: typeof fetch, signal: AbortSignal): Promise<string | null> {
  if (!raw || raw.length > 4096) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !QQ_IMAGE_HOSTS.has(url.hostname)) return null;

  const combined = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  try {
    const response = await fetchImage(url, { signal: combined, redirect: "error" });
    if (!response.ok || Number(response.headers.get("Content-Length")) > MAX_IMAGE_BYTES) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        combined.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          void reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    combined.throwIfAborted();
    const bytes = Buffer.concat(chunks);
    const mime = mimeFromBytes(bytes);
    return mime ? "data:" + mime + ";base64," + bytes.toString("base64") : null;
  } catch {
    return null;
  }
}
