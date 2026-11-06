import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { createTtsGenerator, migrateLegacyTTSFiles } from "./tts";

type Synthesize = NonNullable<Parameters<typeof createTtsGenerator>[0]["synthesize"]>;
const defaultVoice = "zh-CN-XiaoxiaoNeural";
const original = Buffer.from("完整合成音频");
let uploadDir: string;
beforeEach(async () => { uploadDir = await mkdtemp(path.join(os.tmpdir(), "ink-tts-")); });
afterEach(async () => { await rm(uploadDir, { recursive: true, force: true }); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function fixture() {
  const synthesize = vi.fn<Synthesize>().mockResolvedValue(original);
  const generate = createTtsGenerator({ uploadDir: () => uploadDir, synthesize });
  const clip = (url: string) => path.join(uploadDir, url.replace(/^\/uploads\//, ""));
  return { synthesize, generate, clip };
}

describe("语音缓存和取消", () => {
  it("拒绝共享、非正整数身份、无效音色及超长文本，且不创建缓存", async () => {
    const f = fixture();
    for (const id of [undefined, 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(f.generate("你好", defaultVoice, id)).rejects.toThrow(/用户身份/);
    }
    await expect(f.generate("你好", defaultVoice, "shared" as never)).rejects.toThrow(/用户身份/);
    for (const voice of ["../shared", "zh-CN-XiaoxiaoNeural ", "zh-CN-<x>Neural", "https://example.invalid/voice"]) {
      await expect(f.generate("你好", voice, 1)).rejects.toThrow(/音色/);
    }
    for (const text of [" ", "语".repeat(501), `你好${String.fromCharCode(0)}`]) {
      await expect(f.generate(text, defaultVoice, 1)).rejects.toThrow(/朗读文本/);
    }
    expect(f.synthesize).not.toHaveBeenCalled();
    expect(await readdir(uploadDir)).toEqual([]);
  });

  it("同用户同请求共享生成，只在完整输出后出现缓存，后续命中缓存", async () => {
    const f = fixture();
    const started = deferred<void>();
    const rendered = deferred<Buffer>();
    f.synthesize.mockImplementationOnce(() => {
      started.resolve(undefined);
      return rendered.promise;
    });
    const first = f.generate("你好", undefined, 9);
    const second = f.generate("你好", defaultVoice, 9);
    await started.promise;
    const userCache = path.join(uploadDir, "tts", "9");
    expect(await readdir(userCache)).toEqual([]);
    rendered.resolve(original);
    const [firstUrl, secondUrl] = await Promise.all([first, second]);
    expect(firstUrl).toMatch(/^\/uploads\/tts\/9\/[a-f0-9]{64}\.mp3$/);
    expect(secondUrl).toBe(firstUrl);
    expect(await readFile(f.clip(firstUrl))).toEqual(original);
    expect(await readdir(userCache)).toEqual([path.basename(firstUrl)]);
    expect(await f.generate("你好", defaultVoice, 9)).toBe(firstUrl);
    expect(f.synthesize).toHaveBeenCalledTimes(1);
  });

  it("单个调用取消时，同用户的另一个等待者继续收到音频", async () => {
    const f = fixture();
    const started = deferred<AbortSignal>();
    const rendered = deferred<Buffer>();
    f.synthesize.mockImplementationOnce((_text, _voice, signal) => {
      started.resolve(signal);
      return rendered.promise;
    });
    const canceled = new AbortController();
    const first = f.generate("你好", defaultVoice, 9, canceled.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = f.generate("你好", defaultVoice, 9);
    const signal = await started.promise;
    canceled.abort();
    await rejected;
    expect(signal.aborted).toBe(false);
    rendered.resolve(original);
    expect(await readFile(f.clip(await second))).toEqual(original);
    expect(f.synthesize).toHaveBeenCalledTimes(1);
  });

  it("不同用户从不共享任务；最后一个等待者取消后迟到结果不能落盘", async () => {
    const f = fixture();
    const firstSignal = deferred<AbortSignal>();
    const secondSignal = deferred<AbortSignal>();
    const late = deferred<Buffer>();
    const kept = deferred<Buffer>();
    f.synthesize.mockImplementationOnce((_text, _voice, signal) => {
      firstSignal.resolve(signal);
      return late.promise;
    }).mockImplementationOnce((_text, _voice, signal) => {
      secondSignal.resolve(signal);
      return kept.promise;
    });
    const canceled = new AbortController();
    const first = f.generate("你好", defaultVoice, 9, canceled.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const oldSignal = await firstSignal.promise;
    const second = f.generate("你好", defaultVoice, 10);
    const otherSignal = await secondSignal.promise;
    canceled.abort();
    await rejected;
    expect(oldSignal.aborted).toBe(true);
    expect(otherSignal.aborted).toBe(false);
    late.resolve(Buffer.from("取消后的迟到内容"));
    kept.resolve(original);
    const secondUrl = await second;
    expect(secondUrl).toContain("/uploads/tts/10/");
    expect(await readFile(f.clip(secondUrl))).toEqual(original);
    expect(await readdir(path.join(uploadDir, "tts", "9"))).toEqual([]);
    const retried = await f.generate("你好", defaultVoice, 9);
    expect(retried).toContain("/uploads/tts/9/");
    expect(await readFile(f.clip(retried))).toEqual(original);
    expect(f.synthesize).toHaveBeenCalledTimes(3);
  });

  it("空音频不产生缓存，后续可以重新生成", async () => {
    const f = fixture();
    f.synthesize.mockResolvedValueOnce(Buffer.alloc(0));
    await expect(f.generate("你好", defaultVoice, 9)).rejects.toThrow(/有效音频/);
    expect(await readdir(path.join(uploadDir, "tts", "9"))).toEqual([]);
    expect(await readFile(f.clip(await f.generate("你好", defaultVoice, 9)))).toEqual(original);
  });

  it("保留旧迁移入口但不移动现有用户文件", async () => {
    const dir = path.join(uploadDir, "tts");
    await mkdir(dir);
    const legacy = path.join(dir, "existing.mp3");
    await writeFile(legacy, original);
    const previous = ENV.uploadDir;
    ENV.uploadDir = uploadDir;
    try {
      expect(await migrateLegacyTTSFiles()).toBe(0);
      expect(await readdir(dir)).toEqual(["existing.mp3"]);
      expect(await readFile(legacy)).toEqual(original);
    } finally { ENV.uploadDir = previous; }
  });
});
