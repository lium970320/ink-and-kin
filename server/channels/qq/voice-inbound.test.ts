import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseInbound, type QqConfig } from "./core";
import type { QqRepository } from "./repository";
import { QqService } from "./service";
import { createQqVoiceInbound, QQ_RECORD_RESPONSE_BYTES, readQqRecording } from "./voice-inbound";

const token = "a1".repeat(16) + ".amr";
const audio = Buffer.from("合成测试数据");
const secrets = { apiToken: "test-out", receiveToken: "test-in", webhookSecret: "test-signature" };
const initial: QqConfig = {
  id: 1, userId: 2, hookId: "a".repeat(48), apiBaseUrl: "https://bot.example.invalid", botId: "10001",
  targetId: "20001", personaId: 3, generation: 5, enabled: false, secretsEnc: "test-ciphertext",
};
function raw(message: unknown = [{ type: "record", data: { file: token, path: "C:/ignored.amr", url: "https://ignored.invalid/audio" } }], patch = {}) {
  return Buffer.from(JSON.stringify({ post_type: "message", message_type: "private", self_id: 10001, user_id: 20001, message_id: 42, message, ...patch }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
function success(data: object) { return new Response(JSON.stringify({ status: "ok", retcode: 0, data })); }

function fixture() {
  let config = { ...initial };
  const seen = new Set<string>();
  const settled = vi.fn();
  const transport = {
    recording: () => success({ base64: audio.toString("base64"), file: "C:/ignored.mp3", url: "https://ignored.invalid/audio" }),
    delivery: () => success({ message_id: 8 }),
  };
  const state = { channel: false, routeRevision: 0, contextRevision: 12, configRevision: 6, asrEnabled: true };
  const checkRoute = vi.fn(async (_config: QqConfig, expected?: number) => {
    if (state.channel || (expected !== undefined && expected !== state.routeRevision)) throw new Error("route_changed");
    return state.routeRevision;
  });
  const transcribe = vi.fn(async (_user: number, _audio: Buffer, _signal: AbortSignal, revision: number) => ({
    transcription: "  /R  ", configRevision: revision,
  }));
  const voiceChat = vi.fn(async (_config: QqConfig, _context: { revision: number }, _text: string, _signal: AbortSignal) => "回应合成转写。");
  const regularChat = vi.fn(async () => "普通消息回复");
  const handleInbound = vi.fn(async () => true);
  const beforeDispatch = vi.fn<() => void>();
  const claimDelivery = vi.fn(async () => 9);
  const repository: QqRepository = {
    get: async () => ({ ...config }), byHook: async () => ({ ...config }),
    save: async () => { throw new Error("unexpected_save"); },
    enable: async () => { config.enabled = true; return { ...config }; },
    disable: async () => { config = { ...config, enabled: false, generation: config.generation + 1 }; },
    claimInbound: async (_config, key) => {
      if (seen.has(key)) return null;
      seen.add(key);
      return seen.size;
    },
    finishInbound: async () => {}, claimDelivery,
    async dispatchDelivery(_config, _id, start, guard) {
      beforeDispatch();
      if (!config.enabled || config.generation !== _config.generation) throw new Error("binding_changed");
      await guard?.({} as never);
      return { result: start() };
    },
    finishDelivery: async (...args) => { settled(...args); }, recentDeliveries: async () => [],
  };
  const fetch = vi.fn(async (url: string | URL | Request, _request?: RequestInit) => {
    switch (new URL(String(url)).pathname) {
      case "/get_login_info": return success({ user_id: 10001 });
      case "/get_record": return transport.recording();
      case "/send_private_msg": return transport.delivery();
      default: throw new Error("unexpected_request");
    }
  });
  const service = new QqService({
    repository, encrypt: async value => value, decrypt: async () => JSON.stringify(secrets), fetch: fetch as typeof globalThis.fetch,
    chat: regularChat, handleInbound,
    voiceInbound: createQqVoiceInbound({
      async handleChannel(input) {
        if (!state.channel) return false;
        await input.reply("当前频道只支持文字引导。");
        return true;
      },
      checkRoute,
      async guardReply(_tx, nextConfig, revision) { await checkRoute(nextConfig, revision); },
      async readContext(_config, expected) {
        if (expected !== undefined && expected !== state.contextRevision) throw new Error("context_changed");
        return { revision: state.contextRevision };
      },
      async readVoiceConfig() { return { asrEnabled: state.asrEnabled, apiKeyConfigured: state.asrEnabled, revision: state.configRevision }; },
      async checkVoiceConfig(_user, revision) { return revision === state.configRevision; },
      transcribe, chat: voiceChat,
    }),
  });
  async function receive(body = raw(), signed = true) {
    const signature = signed ? `sha1=${createHmac("sha1", secrets.webhookSecret).update(body).digest("hex")}` : undefined;
    return service.receive(initial.hookId, body, signature, "Bearer test-in");
  }
  const requests = (action: string) => fetch.mock.calls.filter(([url]) => String(url).endsWith(`/${action}`));
  const sentText = () => requests("send_private_msg").map(([, request]) => JSON.parse(String(request?.body)).message);
  return {
    service, receive, requests, sentText, voiceChat, regularChat, handleInbound, transcribe, state, transport, beforeDispatch, settled, claimDelivery,
    start: () => service.start(initial.userId, initial.generation), stop: () => service.stop(initial.userId, initial.generation),
    rebind: () => { config = { ...config, personaId: 4, generation: config.generation + 1 }; },
    idle: () => service.waitForIdle(initial.userId),
  };
}

describe("QQ 私聊语音", () => {
  it("仅选择一个语音段，不把地址、路径或混合消息传给取件", () => {
    expect(parseInbound(raw(), initial, true, true)).toMatchObject({ voiceRecord: { id: token } });
    for (const file of ["https://host.invalid/voice", "C:/local.mp3", "../file.amr", "file.amr", `${token}\n`]) {
      expect(parseInbound(raw([{ type: "record", data: { file, url: token } }]), initial, true, true))
        .toMatchObject({ voiceRecord: { id: null } });
    }
    expect(parseInbound(raw([{ type: "record", data: { file: token } }, { type: "text", data: { text: "引导" } }]), initial, true, true))
      .toEqual({ messageId: "42", text: "", unsupportedMedia: true });
  });

  it("只解码规范 Base64，拒绝其他字段、错误响应、无效填充和超限音频", () => {
    const body = (data: object, retcode = 0) => ({ status: "ok", retcode, data });
    expect(readQqRecording(body({ base64: "YQ==", url: "https://ignored.invalid" }))).toEqual(Buffer.from("a"));
    for (const value of [body({ file: "C:/sample.mp3" }), body({ url: "https://ignored.invalid" }), body({ base64: "YQ==" }, 1),
      ...["", "YR==", "YQ", "YQ==\n", "base64://YQ==", Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64")].map(base64 => body({ base64 }))]) {
      expect(() => readQqRecording(value)).toThrow("invalid_record_response");
    }
  });

  it("仅对已验签的绑定事件取件，去重且只把转写交给聊天", async () => {
    const f = fixture(); await f.start();
    await expect(f.receive(raw(), false)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.receive(raw(undefined, { user_id: 20002 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await f.receive()).toEqual({ accepted: true, duplicate: false });
    expect(await f.receive()).toEqual({ accepted: false, duplicate: true });
    await f.idle();
    expect(f.requests("get_record")).toHaveLength(1);
    const [[url, request]] = f.requests("get_record");
    expect(String(url)).toBe(`${initial.apiBaseUrl}/get_record`);
    expect(request).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer test-out" } });
    expect(JSON.parse(String(request?.body))).toEqual({ file_id: token, out_format: "mp3" });
    expect(f.transcribe).toHaveBeenCalledTimes(1);
    expect(f.transcribe).toHaveBeenCalledWith(initial.userId, audio, expect.any(AbortSignal), 6);
    expect(f.voiceChat).toHaveBeenCalledTimes(1);
    expect(f.voiceChat).toHaveBeenCalledWith(expect.objectContaining({ personaId: initial.personaId }), { revision: 12 }, "/R", expect.any(AbortSignal));
    expect(f.regularChat).not.toHaveBeenCalled();
    expect(f.handleInbound).not.toHaveBeenCalled();
    expect(f.claimDelivery).toHaveBeenCalledTimes(1);
    expect(f.claimDelivery).toHaveBeenCalledWith(expect.objectContaining({ userId: initial.userId }), "inbound:10001:20001:42");
    expect(f.sentText()).toEqual(["回应合成转写。"]);
  });

  it("频道仍提示只支持文字，ASR 关闭时也不会取件", async () => {
    const channel = fixture(); channel.state.channel = true; await channel.start();
    await channel.receive(); await channel.idle();
    expect(channel.sentText()).toEqual(["当前频道只支持文字引导。"]);
    expect(channel.requests("get_record")).toHaveLength(0);
    expect(channel.transcribe).not.toHaveBeenCalled();
    const off = fixture(); off.state.asrEnabled = false; await off.start();
    await off.receive(); await off.idle();
    expect(off.sentText()).toEqual([expect.stringContaining("未启用语音识别")]);
    expect(off.requests("get_record")).toHaveLength(0);
    expect(off.voiceChat).not.toHaveBeenCalled();
  });

  it("取件失败、响应超限或识别失败只发送一次固定提示，不写聊天", async () => {
    for (const failure of ["path", "response", "oversize", "recognition"]) {
      const f = fixture(); await f.start();
      if (failure === "response") f.transport.recording = () => success({ url: "https://ignored.invalid" });
      if (failure === "oversize") f.transport.recording = () => new Response(new Uint8Array(QQ_RECORD_RESPONSE_BYTES + 1));
      if (failure === "recognition") f.transcribe.mockRejectedValue(new Error("不应外泄的原始错误"));
      const body = failure === "path" ? raw([{ type: "record", data: { file: "C:/ignored.mp3" } }]) : raw();
      await f.receive(body); await f.receive(body); await f.idle();
      expect(f.sentText()).toEqual(["这条语音未能识别，请重新发送语音或改发文字。"]);
      expect(f.requests("get_record")).toHaveLength(failure === "path" ? 0 : 1);
      if (failure !== "recognition") expect(f.transcribe).not.toHaveBeenCalled();
      expect(f.voiceChat).not.toHaveBeenCalled();
    }
  });

  it("只有取件可超过普通 32 KiB 响应上限", async () => {
    const f = fixture(); await f.start();
    const largerAudio = Buffer.alloc(32 * 1024);
    f.transport.recording = () => success({ base64: largerAudio.toString("base64") });
    f.transport.delivery = () => success({ message_id: 8, pad: "a".repeat(32 * 1024) });
    await f.receive(); await f.idle();
    expect(f.transcribe).toHaveBeenCalledTimes(1);
    expect(f.transcribe).toHaveBeenCalledWith(initial.userId, largerAudio, expect.any(AbortSignal), 6);
    expect(f.settled).toHaveBeenCalledTimes(1);
    expect(f.settled).toHaveBeenCalledWith(initial.userId, 9, "unknown", null, "transport_unconfirmed");
  });

  it.each(["停止", "改绑", "频道进出", "切换对话", "更改识别设置"])("%s 后迟到的转写不会进入聊天或发送", async change => {
    const f = fixture(); await f.start();
    const begun = deferred<AbortSignal>();
    const result = deferred<{ transcription: string; configRevision: number }>();
    f.transcribe.mockImplementation(async (_user, _audio, signal) => { begun.resolve(signal); return result.promise; });
    await f.receive();
    const signal = await begun.promise;
    if (change === "停止") { await f.stop(); expect(signal.aborted).toBe(true); }
    if (change === "改绑") f.rebind();
    if (change === "频道进出") f.state.routeRevision += 2;
    if (change === "切换对话") f.state.contextRevision++;
    if (change === "更改识别设置") f.state.configRevision++;
    result.resolve({ transcription: "迟到的文字", configRevision: 6 });
    await f.idle();
    expect(f.voiceChat).not.toHaveBeenCalled();
    expect(f.sentText()).toEqual([]);
  });

  it("投递占键后切换频道，锁内复核会阻止旧回复发送", async () => {
    const f = fixture(); await f.start();
    f.beforeDispatch.mockImplementation(() => { f.state.routeRevision += 2; });
    await f.receive(); await f.idle();
    expect(f.voiceChat).toHaveBeenCalledOnce();
    expect(f.sentText()).toEqual([]);
    expect(f.settled).toHaveBeenCalledTimes(1);
    expect(f.settled).toHaveBeenCalledWith(initial.userId, 9, "failed", null, "dispatch_rejected");
  });
});
