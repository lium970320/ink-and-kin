import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_VOICE_UPLOAD_BYTES, transcribeAudio } from "./asr";
import type { VoiceSecretConfig } from "./config";

const config: VoiceSecretConfig = {
  asrEnabled: true, baseUrl: "https://speech.example/v1", model: "synthetic-asr",
  timeoutMs: 1_000, ttsEnabled: true, revision: 3, apiKey: "synthetic-voice-key",
};
const audio = { buffer: Buffer.from([1, 2, 3]), fileName: "recording.wav", mimeType: "audio/wav" };

function request(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

afterEach(() => { vi.useRealTimers(); });

describe("单站语音转写", () => {
  it("发送含模型、文件与非流式开关的 multipart，只使用本账号密钥", async () => {
    const fetch = request(Response.json({ text: "  合成转写。  " }));
    await expect(transcribeAudio({ config, audio, fetch })).resolves.toBe("合成转写。");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetch.mock.calls[0];
    expect(endpoint).toBe("https://speech.example/v1/audio/transcriptions");
    expect(init).toMatchObject({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) });
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer synthetic-voice-key");
    expect(headers.has("content-type")).toBe(false);
    const form = init?.body as FormData;
    expect(form.get("model")).toBe("synthetic-asr");
    expect(form.get("stream")).toBe("false");
    const file = form.get("file") as File;
    expect(file).toMatchObject({ name: "recording.wav", type: "audio/wav", size: 3 });
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("支持已知兼容响应，并拒绝未知结构、空值和过长转写", async () => {
    const compatibility = request(Response.json({ choices: [{ message: { content: "兼容响应。" } }] }));
    await expect(transcribeAudio({ config, audio, fetch: compatibility })).resolves.toBe("兼容响应。");
    for (const payload of [
      { data: { text: "不能读取任意嵌套字段" } },
      { text: "  " },
      { text: "海".repeat(8001) },
      { choices: [{ message: { content: [{ text: "未约定的数组形状" }] } }] },
    ]) {
      await expect(transcribeAudio({ config, audio, fetch: request(Response.json(payload)) }))
        .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("取消超限的分块响应，不等待上游结束", async () => {
    const cancel = vi.fn();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(128 * 1024));
        controller.enqueue(new Uint8Array(128 * 1024 + 1));
      },
      cancel,
    });
    await expect(transcribeAudio({ config, audio, fetch: request(new Response(oversized)) }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("拒绝无效输入和未配置请求，不调用网络", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(transcribeAudio({ config: { ...config, apiKey: null }, audio, fetch }))
      .rejects.toMatchObject({ code: "INVALID_CONFIG" });
    await expect(transcribeAudio({ config, audio: { ...audio, buffer: Buffer.alloc(MAX_VOICE_UPLOAD_BYTES + 1) }, fetch }))
      .rejects.toMatchObject({ code: "INVALID_AUDIO" });
    await expect(transcribeAudio({ config, audio: { ...audio, fileName: "../audio.wav" }, fetch }))
      .rejects.toMatchObject({ code: "INVALID_AUDIO" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("上游拒绝及网络异常均不透出原始错误，也不回退重试", async () => {
    const rejected = request(new Response("机密上游响应 synthetic-voice-key", { status: 429 }));
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error("机密网络错误 synthetic-voice-key"));
    for (const [send, code] of [[rejected, "UPSTREAM_REJECTED"], [network, "NETWORK_ERROR"]] as const) {
      const result = await transcribeAudio({ config, audio, fetch: send }).catch((error: unknown) => error);
      expect(result).toMatchObject({ name: "VoiceTranscriptionError", code });
      expect(String(result)).not.toContain("机密");
      expect(String(result)).not.toContain("synthetic-voice-key");
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it("超时可终止不理会取消信号的请求", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const failure = expect(transcribeAudio({ config, audio, fetch })).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(config.timeoutMs);
    await failure;
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("调用者取消也会停止正在等待的响应体", async () => {
    const caller = new AbortController();
    const cancel = vi.fn();
    let begin!: () => void;
    const reading = new Promise<void>(resolve => { begin = resolve; });
    const stream = new ReadableStream<Uint8Array>({ pull() { begin(); }, cancel });
    const fetch = request(new Response(stream));
    const failure = expect(transcribeAudio({ config, audio, fetch, signal: caller.signal }))
      .rejects.toMatchObject({ code: "CANCELLED" });
    await reading;
    caller.abort(new Error("调用者私有原因"));
    await failure;
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
