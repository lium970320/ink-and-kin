import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { ENV } from "../_core/env";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
const MAX_PCM_BYTES = 30 * SAMPLE_RATE * BYTES_PER_SAMPLE;
const DECODE_TIMEOUT_MS = 20_000;

type AudioFormat = "matroska" | "ogg" | "mp3" | "wav" | "mov";
type AudioErrorCode = "invalid_audio" | "audio_too_large" | "audio_too_long" | "normalizer_unavailable" | "normalizer_timeout";

export class AudioNormalizationError extends Error {
  constructor(public readonly code: AudioErrorCode, message: string) {
    super(message);
    this.name = "AudioNormalizationError";
  }
}

interface AudioInput { buffer: Buffer; fileName?: string; signal?: AbortSignal; }
interface NormalizedAudio { buffer: Buffer; fileName: "voice.wav"; mimeType: "audio/wav"; durationSeconds: number; }
interface AudioProcess {
  stdout: Readable;
  kill(signal: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
}
type SpawnAudio = (file: string, args: string[], options: { shell: false; windowsHide: true; stdio: ["ignore", "pipe", "ignore"] }) => AudioProcess;
interface NormalizerOptions { uploadDir: string; ffmpegPath?: string; timeoutMs?: number; spawnProcess?: SpawnAudio; }

function invalidAudio() { return new AudioNormalizationError("invalid_audio", "音频格式无效或无法解码。"); }
function unavailable() { return new AudioNormalizationError("normalizer_unavailable", "音频转换暂不可用。"); }

function tag(input: Buffer, start: number, length: number): string {
  return input.toString("latin1", start, start + length);
}

function readVint(input: Buffer, offset: number, widthLimit: number, keepMarker = false) {
  const first = input[offset];
  if (!first) return null;
  let width = 1;
  let marker = 0x80;
  while (!(first & marker)) { width++; marker >>= 1; }
  if (width > widthLimit || offset + width > input.length) return null;
  let value = keepMarker ? first : first & (marker - 1);
  for (let n = 1; n < width; n++) value = value * 256 + input[offset + n];
  return Number.isSafeInteger(value) ? { width, value } : null;
}

function isWebM(input: Buffer): boolean {
  if (input.length < 10 || input.readUInt32BE(0) !== 0x1a45dfa3) return false;
  const size = readVint(input, 4, 8);
  if (!size || size.value > 4096) return false;
  let at = 4 + size.width;
  const end = at + size.value;
  if (end > input.length) return false;
  while (at < end) {
    const id = readVint(input, at, 4, true);
    if (!id) return false;
    at += id.width;
    const length = readVint(input, at, 8);
    if (!length) return false;
    at += length.width;
    if (at + length.value > end) return false;
    if (id.value === 0x4282) return length.value === 4 && tag(input, at, 4) === "webm";
    at += length.value;
  }
  return false;
}

function isMp3(input: Buffer): boolean {
  if (input.length >= 10 && tag(input, 0, 3) === "ID3") {
    const sizeBytes = input.subarray(6, 10);
    if (input[3] < 2 || input[3] > 4 || sizeBytes.some(value => value > 127)) return false;
    const size = sizeBytes.reduce((total, value) => total * 128 + value, 0);
    return input.length > 10 + size;
  }
  if (input.length < 4) return false;
  const info = input[1], rates = input[2], emphasis = input[3];
  const bitrate = rates >> 4;
  return input[0] === 0xff && (info & 0xe0) === 0xe0 && ((info >> 3) & 3) !== 1 && ((info >> 1) & 3) === 1 &&
    bitrate > 0 && bitrate < 15 && ((rates >> 2) & 3) !== 3 && (emphasis & 3) !== 2;
}

const mp4Brands = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "M4A ", "M4B ", "dash", "msdh", "msix"]);
function isMp4(input: Buffer): boolean {
  if (input.length < 16 || tag(input, 4, 4) !== "ftyp") return false;
  const size = input.readUInt32BE(0);
  if (size < 16 || size > input.length || size > 4096 || size % 4) return false;
  if (mp4Brands.has(tag(input, 8, 4))) return true;
  for (let at = 16; at < size; at += 4) if (mp4Brands.has(tag(input, at, 4))) return true;
  return false;
}

function identifyAudio(input: Buffer): AudioFormat {
  if (input.length >= 12 && tag(input, 0, 4) === "RIFF" && tag(input, 8, 4) === "WAVE") return "wav";
  if (input.length >= 27 && tag(input, 0, 4) === "OggS" && input[4] === 0) return "ogg";
  if (isWebM(input)) return "matroska";
  if (isMp4(input)) return "mov";
  if (isMp3(input)) return "mp3";
  throw invalidAudio();
}

function ffmpegArgs(format: AudioFormat, inputPath: string): string[] {
  const formatOptions = format === "mov" ? ["-enable_drefs", "0", "-use_absolute_path", "0"] : [];
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-xerror", "-max_alloc", "67108864",
    "-filter_threads", "1", "-threads", "1", "-protocol_whitelist", "file,pipe",
    "-f", format, ...formatOptions, "-i", inputPath,
    "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar", String(SAMPLE_RATE),
    "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
  ];
}

function decodeAudio(
  start: SpawnAudio, ffmpegPath: string, format: AudioFormat, inputPath: string, timeoutMs: number, signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted();
  let child: AudioProcess;
  try { child = start(ffmpegPath, ffmpegArgs(format, inputPath), { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return Promise.reject(unavailable()); }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: unknown;
    const fail = (reason: unknown, kill = true) => {
      if (failure !== undefined) return;
      failure = reason;
      if (kill) {
        try { child.kill("SIGKILL"); } catch { /* close/error still settles the child */ }
      }
    };
    const abort = () => fail(signal?.reason ?? new DOMException("音频转换已取消。", "AbortError"));
    const timeout = setTimeout(() => fail(new AudioNormalizationError("normalizer_timeout", "音频转换超时。")), timeoutMs);
    timeout.unref?.();
    child.once("error", () => fail(unavailable(), false));
    child.stdout.on("error", () => fail(invalidAudio()));
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure !== undefined) return;
      size += chunk.length;
      // Count decoded samples rather than trusting the file's duration or timestamps.
      if (size > MAX_PCM_BYTES) {
        fail(new AudioNormalizationError("audio_too_long", "音频最多 30 秒。"));
      } else {
        chunks.push(chunk);
      }
    });
    child.once("close", code => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (failure !== undefined) reject(failure);
      else if (code !== 0 || !size || size % BYTES_PER_SAMPLE !== 0) reject(invalidAudio());
      else resolve(Buffer.concat(chunks, size));
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function toWav(pcm: Buffer): NormalizedAudio {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  wav.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  wav.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return { buffer: wav, fileName: "voice.wav", mimeType: "audio/wav", durationSeconds: pcm.length / BYTES_PER_SAMPLE / SAMPLE_RATE };
}

export function createAudioNormalizer({ uploadDir, ffmpegPath = "ffmpeg", timeoutMs = DECODE_TIMEOUT_MS, spawnProcess = spawn }: NormalizerOptions) {
  return async ({ buffer, signal }: AudioInput): Promise<NormalizedAudio> => {
    signal?.throwIfAborted();
    if (!Buffer.isBuffer(buffer)) throw invalidAudio();
    if (buffer.length > MAX_INPUT_BYTES) throw new AudioNormalizationError("audio_too_large", "音频文件最多 8 MiB。");
    const format = identifyAudio(buffer);
    const tempRoot = path.resolve(uploadDir, ".voice-tmp");
    let directory: string;
    try {
      await mkdir(tempRoot, { recursive: true, mode: 0o700 });
      if (!(await lstat(tempRoot)).isDirectory()) throw unavailable();
      signal?.throwIfAborted();
      directory = await mkdtemp(path.join(tempRoot, "voice-"));
    } catch {
      signal?.throwIfAborted();
      throw unavailable();
    }
    const inputPath = path.join(directory, "input.audio");
    try {
      try { await writeFile(inputPath, buffer, { flag: "wx", mode: 0o600, signal }); }
      catch { signal?.throwIfAborted(); throw unavailable(); }
      const pcm = await decodeAudio(spawnProcess, ffmpegPath, format, inputPath, timeoutMs, signal);
      signal?.throwIfAborted();
      return toWav(pcm);
    } finally {
      // Delete only our fixed input file and our own (now empty) directory.
      try { await rm(inputPath, { force: true }); }
      finally { await rmdir(directory); }
    }
  };
}

export function normalizeAudio(input: AudioInput): Promise<NormalizedAudio> {
  return createAudioNormalizer({ uploadDir: ENV.uploadDir, ffmpegPath: process.env.FFMPEG_PATH?.trim() || "ffmpeg" })(input);
}
