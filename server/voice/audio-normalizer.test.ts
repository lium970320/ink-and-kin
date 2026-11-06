import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioNormalizer } from "./audio-normalizer";

function childProcess() {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const kill = vi.fn((signal: NodeJS.Signals) => {
    queueMicrotask(() => { stdout.destroy(); events.emit("close", null, signal); });
    return true;
  });
  return {
    process: Object.assign(events, { stdout, kill }),
    finish(pcm: Buffer, code = 0) {
      stdout.end(pcm);
      queueMicrotask(() => events.emit("close", code, null));
    },
    failStart() {
      events.emit("error", new Error("找不到程序"));
      events.emit("close", 1, null);
    },
  };
}

type Spawn = NonNullable<Parameters<typeof createAudioNormalizer>[0]["spawnProcess"]>;
const wav = Buffer.from("RIFF0000WAVE");
const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(23)]);
const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom0000mp42isom")]);

let uploadDir: string;
let tempRoot: string;
beforeEach(async () => {
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "ink-voice-"));
  tempRoot = path.join(uploadDir, ".voice-tmp");
});
afterEach(async () => { await rm(uploadDir, { recursive: true, force: true }); });

describe("音频转换边界", () => {
  it.each([[wav, "wav"], [webm, "matroska"], [ogg, "ogg"], [mp3, "mp3"], [mp4, "mov"]] as const)(
    "只根据内容选择受支持的解复用器：%s → %s", async (buffer, format) => {
      const child = childProcess();
      const start = vi.fn<Spawn>().mockImplementation((_file, args) => {
        const inputPath = args[args.indexOf("-i") + 1];
        expect(path.dirname(path.dirname(inputPath))).toBe(tempRoot);
        expect(path.basename(inputPath)).toBe("input.audio");
        expect(readFileSync(inputPath)).toEqual(buffer);
        queueMicrotask(() => child.finish(Buffer.alloc(16_000)));
        return child.process;
      });
      const normalize = createAudioNormalizer({ uploadDir, ffmpegPath: "trusted-ffmpeg", spawnProcess: start });
      const result = await normalize({ buffer, fileName: "../网络列表.m3u8" });
      expect(result).toMatchObject({ fileName: "voice.wav", mimeType: "audio/wav", durationSeconds: 0.5 });
      expect(result.buffer.toString("ascii", 0, 12).slice(8)).toBe("WAVE");
      expect(result.buffer.readUInt32LE(4)).toBe(result.buffer.length - 8);
      expect(result.buffer.readUInt16LE(22)).toBe(1);
      expect(result.buffer.readUInt32LE(24)).toBe(16_000);
      expect(result.buffer.readUInt16LE(34)).toBe(16);
      expect(result.buffer.readUInt32LE(40)).toBe(16_000);
      const [binary, args, opts] = start.mock.calls[0];
      expect(binary).toBe("trusted-ffmpeg");
      expect(opts).toMatchObject({ shell: false, windowsHide: true });
      expect(args[args.indexOf("-f") + 1]).toBe(format);
      expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("file,pipe");
      if (format === "mov") {
        expect(args[args.indexOf("-enable_drefs") + 1]).toBe("0");
        expect(args[args.indexOf("-use_absolute_path") + 1]).toBe("0");
      }
      expect(args).not.toContain("-t");
      expect(await readdir(tempRoot)).toEqual([]);
    },
  );

  it("在启动转换前拒绝伪装格式、播放列表和超过 8 MiB 的输入", async () => {
    const start = vi.fn<Spawn>();
    const normalize = createAudioNormalizer({ uploadDir, spawnProcess: start });
    await expect(normalize({ buffer: Buffer.from("#EXTM3U http://example.invalid/private"), fileName: "voice.mp3" }))
      .rejects.toMatchObject({ code: "invalid_audio" });
    await expect(normalize({ buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x65, 0x76, 0x69, 0x6c]) }))
      .rejects.toMatchObject({ code: "invalid_audio" });
    await expect(normalize({ buffer: Buffer.alloc(8 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: "audio_too_large" });
    expect(start).not.toHaveBeenCalled();
    expect(await readdir(uploadDir)).toEqual([]);
  });

  it("允许整 30 秒；再多一个样本就终止解码并只清理自己的临时目录", async () => {
    await mkdir(tempRoot);
    await writeFile(path.join(tempRoot, "other-request"), "保留");
    const child = childProcess();
    const long = childProcess();
    const start = vi.fn<Spawn>().mockImplementationOnce(() => {
      queueMicrotask(() => child.finish(Buffer.alloc(960_000)));
      return child.process;
    }).mockImplementationOnce(() => {
      queueMicrotask(() => long.finish(Buffer.alloc(960_002)));
      return long.process;
    });
    const normalize = createAudioNormalizer({ uploadDir, spawnProcess: start });
    expect((await normalize({ buffer: wav })).durationSeconds).toBe(30);
    await expect(normalize({ buffer: wav })).rejects.toMatchObject({ code: "audio_too_long" });
    expect(long.process.kill).toHaveBeenCalledWith("SIGKILL");
    expect(await readdir(tempRoot)).toEqual(["other-request"]);
  });

  it("取消或超时都会终止进程，并等待它关闭后清理输入", async () => {
    const stop = new AbortController();
    const aborted = childProcess();
    const timedOut = childProcess();
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const start = vi.fn<Spawn>().mockImplementationOnce(() => {
      started();
      return aborted.process;
    }).mockReturnValueOnce(timedOut.process);
    const normalize = createAudioNormalizer({ uploadDir, spawnProcess: start, timeoutMs: 100 });
    const result = normalize({ buffer: wav, signal: stop.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await entered;
    stop.abort();
    await rejected;
    expect(aborted.process.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(normalize({ buffer: wav })).rejects.toMatchObject({ code: "normalizer_timeout" });
    expect(timedOut.process.kill).toHaveBeenCalledWith("SIGKILL");
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("区分启动失败和空音轨，均不会留下上传输入", async () => {
    const unavailable = childProcess();
    const empty = childProcess();
    const start = vi.fn<Spawn>().mockImplementationOnce(() => {
      queueMicrotask(() => unavailable.failStart());
      return unavailable.process;
    }).mockImplementationOnce(() => {
      queueMicrotask(() => empty.finish(Buffer.alloc(0)));
      return empty.process;
    });
    const normalize = createAudioNormalizer({ uploadDir, spawnProcess: start });
    await expect(normalize({ buffer: wav })).rejects.toMatchObject({ code: "normalizer_unavailable" });
    await expect(normalize({ buffer: wav })).rejects.toMatchObject({ code: "invalid_audio" });
    expect(await readdir(tempRoot)).toEqual([]);
  });
});
