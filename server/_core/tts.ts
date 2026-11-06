import { createHash, randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { ENV } from "./env";

const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const MAX_TEXT_LENGTH = 500;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const TTS_TIMEOUT_MS = 30_000;
const voicePattern = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,12}){1,3}-[A-Za-z][A-Za-z0-9]*Neural$/;

// Bundled servers and the development runner use the same worker. Edge's SDK
// does not expose a signal, so stopping the worker also stops its socket.
const edgeWorker = `
import { parentPort, workerData } from "node:worker_threads";
(async () => {
  const { tts } = await import(workerData.moduleUrl);
  const xml = workerData.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const audio = await tts(xml, { voice: workerData.voice });
  if (!audio || !audio.byteLength || audio.byteLength > workerData.maxAudioBytes) throw new Error();
  const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio) : Uint8Array.from(audio);
  parentPort.postMessage(bytes, [bytes.buffer]);
})().catch(() => parentPort.postMessage(null));
`;
const edgeWorkerUrl = new URL(`data:text/javascript,${encodeURIComponent(edgeWorker)}`);

type Synthesize = (text: string, voice: string, signal: AbortSignal) => Promise<Buffer>;

const synthesizeWithEdge: Synthesize = (text, voice, signal) => {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(edgeWorkerUrl, {
      execArgv: [], workerData: { moduleUrl: import.meta.resolve("edge-tts"), text, voice, maxAudioBytes: MAX_AUDIO_BYTES },
      stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 64 },
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    function finish(error: unknown, bytes?: Buffer) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      void worker.terminate().catch(() => undefined);
      if (bytes) resolve(bytes);
      else reject(error);
    }
    const abort = () => finish(signal.reason ?? new DOMException("语音生成已取消。", "AbortError"));
    const timeout = setTimeout(() => finish(new Error("语音生成超时。")), TTS_TIMEOUT_MS);
    timeout.unref?.();
    worker.once("message", (value: unknown) => {
      if (value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= MAX_AUDIO_BYTES) finish(null, Buffer.from(value));
      else finish(new Error("语音服务未返回有效音频。"));
    });
    worker.once("error", () => finish(new Error("语音服务暂不可用。")));
    worker.once("exit", () => finish(new Error("语音服务未完成生成。")));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
};

interface TtsOptions { uploadDir: () => string; synthesize?: Synthesize; }
interface InFlight { controller: AbortController; waiters: number; settled: boolean; promise: Promise<string>; }

async function directory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (!(await lstat(dir)).isDirectory()) throw new Error("语音缓存目录不可用。");
}

async function hasClip(filePath: string): Promise<boolean> {
  try {
    const file = await lstat(filePath);
    if (!file.isFile()) throw new Error("语音缓存路径不可用。");
    return file.size > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function validateText(text: string): string {
  if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH || !text.trim()) {
    throw new TypeError("朗读文本须为 1 至 500 字符。");
  }
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) throw new TypeError("朗读文本包含无效字符。");
  }
  return text.trim();
}

export function createTtsGenerator({ uploadDir, synthesize = synthesizeWithEdge }: TtsOptions) {
  const pending = new Map<string, InFlight>();

  async function createClip(root: string, dir: string, filePath: string, url: string, text: string, voice: string, signal: AbortSignal) {
    await directory(root);
    await directory(dir);
    if (await hasClip(filePath)) { signal.throwIfAborted(); return url; }
    signal.throwIfAborted();
    const audio = await synthesize(text, voice, signal);
    signal.throwIfAborted();
    if (!Buffer.isBuffer(audio) || audio.length === 0 || audio.length > MAX_AUDIO_BYTES) throw new Error("语音服务未返回有效音频。");
    const temp = path.join(dir, `.tts-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, audio, { flag: "wx", mode: 0o600, signal });
      signal.throwIfAborted();
      // Publication is a short atomic rename. No abort event can interleave
      // between the check and committing the complete clip.
      renameSync(temp, filePath);
      return url;
    } finally {
      await rm(temp, { force: true });
    }
  }

  function waitForClip(entry: InFlight, key: string, signal?: AbortSignal): Promise<string> {
    entry.waiters++;
    return new Promise((resolve, reject) => {
      let finished = false;
      function release(): boolean {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener("abort", abort);
        if (--entry.waiters === 0 && !entry.settled) {
          if (pending.get(key) === entry) pending.delete(key);
          entry.controller.abort();
        }
        return true;
      }
      const abort = () => {
        if (release()) reject(signal?.reason ?? new DOMException("语音生成已取消。", "AbortError"));
      };
      entry.promise.then(
        url => { if (release()) resolve(url); },
        error => { if (release()) reject(error); },
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  return async function generate(text: string, voice: string = DEFAULT_VOICE, userId?: number, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId < 1) {
      throw new TypeError("语音生成须使用有效的用户身份。");
    }
    text = validateText(text);
    if (typeof voice !== "string" || voice.length > 64 || voice.trim() !== voice || !voicePattern.test(voice)) {
      throw new TypeError("朗读音色无效。");
    }
    const scope = String(userId);
    const root = path.resolve(uploadDir(), "tts");
    const dir = path.join(root, scope);
    const hash = createHash("sha256").update(JSON.stringify([text, voice])).digest("hex");
    const fileName = `${hash}.mp3`;
    const key = path.join(dir, fileName);
    const url = `/uploads/tts/${scope}/${fileName}`;
    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const started: InFlight = {
        controller, waiters: 0, settled: false,
        promise: createClip(root, dir, key, url, text, voice, controller.signal).finally(() => {
          started.settled = true;
          if (pending.get(key) === started) pending.delete(key);
        }),
      };
      entry = started;
      pending.set(key, entry);
    }
    return waitForClip(entry, key, signal);
  };
}

export const generateTTS = createTtsGenerator({ uploadDir: () => ENV.uploadDir });

/** Compatibility entry point. Existing files and URLs are left in place. */
export async function migrateLegacyTTSFiles(): Promise<number> {
  return 0;
}
