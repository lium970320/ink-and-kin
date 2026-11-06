import {
  normalizeVoiceApiKey, normalizeVoiceSettings, voiceTranscriptionUrl, type VoiceSecretConfig,
} from "./config";

export const MAX_VOICE_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TRANSCRIPT_CHARACTERS = 8000;

export type VoiceTranscriptionErrorCode =
  | "INVALID_CONFIG" | "INVALID_AUDIO" | "CANCELLED" | "TIMEOUT"
  | "UPSTREAM_REJECTED" | "INVALID_RESPONSE" | "NETWORK_ERROR";

const MESSAGES: Record<VoiceTranscriptionErrorCode, string> = {
  INVALID_CONFIG: "请先开启并完整配置语音转写。",
  INVALID_AUDIO: "语音文件为空、格式无效或超过 8 MiB。",
  CANCELLED: "语音转写已取消。",
  TIMEOUT: "语音转写超时，请稍后重试。",
  UPSTREAM_REJECTED: "语音服务未接受转写请求，请检查服务和配置。",
  INVALID_RESPONSE: "语音服务未返回有效文字。",
  NETWORK_ERROR: "暂时无法连接语音服务。",
};

export class VoiceTranscriptionError extends Error {
  constructor(public readonly code: VoiceTranscriptionErrorCode) {
    super(MESSAGES[code]);
    this.name = "VoiceTranscriptionError";
  }
}

export interface VoiceTranscriptionInput {
  config: VoiceSecretConfig;
  audio: { buffer: Buffer; fileName: string; mimeType: string };
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

function fileInfo(audio: VoiceTranscriptionInput["audio"]) {
  const { buffer } = audio;
  const fileName = typeof audio.fileName === "string" ? audio.fileName.trim() : "";
  const mimeType = typeof audio.mimeType === "string" ? audio.mimeType.trim().toLowerCase() : "";
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_VOICE_UPLOAD_BYTES
    || !fileName || fileName.length > 160 || fileName === "." || fileName === ".."
    || /[\\/"\u0000-\u001f\u007f]/.test(fileName) || !/^audio\/[a-z0-9][a-z0-9.+-]{0,63}$/.test(mimeType)) {
    throw new VoiceTranscriptionError("INVALID_AUDIO");
  }
  return { buffer, fileName, mimeType };
}

function cancelBody(response: Response) {
  // Disposal must not block the caller or expose any upstream body/error text.
  try { void response.body?.cancel().catch(() => undefined); } catch { /* Best effort. */ }
}

function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void pending.then(value => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    if (signal.aborted) onAbort();
  });
}

async function readBounded(response: Response, signal: AbortSignal) {
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_RESPONSE_BYTES) {
    cancelBody(response);
    throw new VoiceTranscriptionError("INVALID_RESPONSE");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new VoiceTranscriptionError("INVALID_RESPONSE");
  const chunks: Uint8Array[] = [];
  let received = 0;
  let done = false;
  try {
    while (true) {
      const piece = await waitFor(reader.read(), signal);
      if (piece.done) { done = true; break; }
      received += piece.value.byteLength;
      if (received > MAX_RESPONSE_BYTES) throw new VoiceTranscriptionError("INVALID_RESPONSE");
      if (piece.value.byteLength) chunks.push(piece.value);
    }
  } finally {
    if (!done) {
      try { void reader.cancel().catch(() => undefined); } catch { /* Best effort. */ }
    }
    try { reader.releaseLock(); } catch { /* The last read may have been cancelled. */ }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, received)); }
  catch { throw new VoiceTranscriptionError("INVALID_RESPONSE"); }
}

function transcript(raw: string): string {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new VoiceTranscriptionError("INVALID_RESPONSE"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VoiceTranscriptionError("INVALID_RESPONSE");
  const payload = value as { text?: unknown; choices?: unknown };
  let text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text && Array.isArray(payload.choices)) {
    const first = payload.choices[0] as { message?: { content?: unknown } } | undefined;
    if (typeof first?.message?.content === "string") text = first.message.content.trim();
  }
  const characters = Array.from(text);
  if (!text || characters.length > MAX_TRANSCRIPT_CHARACTERS || characters.some(character => {
    const unit = character.charCodeAt(0);
    return unit === 0 || (character.length === 1 && unit >= 0xd800 && unit <= 0xdfff);
  })) throw new VoiceTranscriptionError("INVALID_RESPONSE");
  return text;
}

/** A single request to the selected account's endpoint. Never falls back to another provider. */
export async function transcribeAudio(input: VoiceTranscriptionInput): Promise<string> {
  if (input.signal?.aborted) throw new VoiceTranscriptionError("CANCELLED");
  let endpoint: string;
  let key: string;
  let model: string;
  let timeoutMs: number;
  try {
    const settings = normalizeVoiceSettings(input.config);
    if (!settings.asrEnabled || !settings.model || !input.config.apiKey) throw new Error();
    endpoint = voiceTranscriptionUrl(settings.baseUrl);
    key = normalizeVoiceApiKey(input.config.apiKey);
    model = settings.model;
    timeoutMs = settings.timeoutMs;
  } catch {
    throw new VoiceTranscriptionError("INVALID_CONFIG");
  }
  const { buffer, fileName, mimeType } = fileInfo(input.audio);
  const body = new FormData();
  body.append("model", model);
  body.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), fileName);
  body.append("stream", "false");

  const controller = new AbortController();
  let stopped: "CANCELLED" | "TIMEOUT" | undefined;
  function stop(code: "CANCELLED" | "TIMEOUT") {
    if (stopped) return;
    stopped = code;
    controller.abort(new VoiceTranscriptionError(code));
  }
  const onCancel = () => stop("CANCELLED");
  input.signal?.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
  try {
    if (input.signal?.aborted) onCancel();
    if (stopped) throw new VoiceTranscriptionError(stopped);
    const send = input.fetch ?? globalThis.fetch;
    const request = Promise.resolve(send(endpoint, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      body, signal: controller.signal, redirect: "error",
    }));
    // A response arriving after the timeout is not allowed to leave a stream open.
    void request.then(response => { if (stopped) cancelBody(response); }, () => undefined);
    const response = await waitFor(request, controller.signal);
    if (!response.ok) {
      cancelBody(response);
      throw new VoiceTranscriptionError("UPSTREAM_REJECTED");
    }
    const text = transcript(await readBounded(response, controller.signal));
    if (stopped) throw new VoiceTranscriptionError(stopped);
    return text;
  } catch (error) {
    if (stopped) throw new VoiceTranscriptionError(stopped);
    if (error instanceof VoiceTranscriptionError) throw error;
    throw new VoiceTranscriptionError("NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onCancel);
  }
}
