import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DbTransaction } from "../../db";
import type { QqConfig } from "./core";
import { qqSceneImageOperationId } from "./core";
import type { QqRepository } from "./repository";
import { createQqSceneImageInbound, QqService } from "./service";

type JobResult = { status: string; outputKey?: string };
const initial: QqConfig = { id: 1, userId: 2, hookId: "a".repeat(48), apiBaseUrl: "https://bot.example.invalid",
  botId: "10001", targetId: "20001", personaId: 3, generation: 5, enabled: false, secretsEnc: "合成密文" };
const secrets = { apiToken: "合成令牌", receiveToken: "", webhookSecret: "合成签名" };
const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const outputKey = "scene-images/2/00000000-0000-4000-8000-000000000001.png";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
function response(data: object) { return new Response(JSON.stringify({ status: "ok", retcode: 0, data })); }
type ChatEvent = { type: "delta"; text: string } | { type: "error" } | { type: "done"; crisis?: boolean };
async function* chatEvents(...events: ChatEvent[]) { yield* events; }

function fixture() {
  let config = { ...initial };
  let routeRevision = 1;
  let channelActive = false;
  const seen = new Set<string>();
  const keys = new Map<string, number>();
  const trace: string[] = [];
  const request = { contextRevision: 12, sceneId: 7 };
  let contextRevision = request.contextRevision;
  const receipts = { text: "confirmed", image: "confirmed" };
  const finishDelivery = vi.fn();
  const regularChat = vi.fn(async () => "普通回复");
  const voiceInbound = vi.fn(async () => true);
  const jobStarted = deferred<AbortSignal>();
  const wait = vi.fn(async (_user: number, _id: string, _signal: AbortSignal): Promise<JobResult> => ({ status: "succeeded", outputKey }));
  const load = vi.fn(async () => ({ data: image }));
  const start = vi.fn(async (_request: typeof request, options: { signal: AbortSignal; reply: string; beforePublish(tx: DbTransaction): Promise<void> }) => {
    trace.push("start");
    jobStarted.resolve(options.signal);
    await options.beforePublish({} as never);
    return { id: "job" };
  });
  const prepare = vi.fn(async (input: { message: string; operationId: string }): Promise<{
    request?: typeof request; requested: boolean; message: string; errorMessage?: string; contextRevision?: number; sceneId?: number | null;
  }> => ({ request, requested: true, message: input.message.slice(2).trim() }));
  const chat = vi.fn(async (): Promise<AsyncIterable<ChatEvent> | null> => chatEvents({ type: "delta", text: "继续记录灯塔情节。" }, { type: "done" }));
  const chatWithoutImage = vi.fn(async (): Promise<AsyncIterable<ChatEvent> | null> => chatEvents({ type: "delta", text: "保留文字叙事。" }, { type: "done" }));
  const cancel = vi.fn(async (_userId: number, _operationId: string) => {});
  const beforeDispatch = vi.fn<() => void>();
  const checkRoute = vi.fn(async (_config: QqConfig, expected?: number) => {
    if (channelActive || (expected !== undefined && expected !== routeRevision)) throw new Error("route_changed");
    return routeRevision;
  });
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
    finishInbound: async () => {},
    claimDelivery: async (_config, key) => {
      if (keys.has(key)) return null;
      keys.set(key, keys.size + 1);
      return keys.get(key)!;
    },
    async dispatchDelivery(_config, _id, begin, guard) {
      beforeDispatch();
      await guard?.({} as never);
      return { result: begin() };
    },
    finishDelivery: async (...args) => { finishDelivery(...args); }, recentDeliveries: async () => [],
  };
  const sent: unknown[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    if (String(url).endsWith("/get_login_info")) return response({ user_id: 10001 });
    if (!String(url).endsWith("/send_private_msg")) throw new Error("unexpected_transport");
    const payload: unknown = JSON.parse(String(requestInit?.body)).message;
    const type = Array.isArray(payload) ? "image" : "text";
    trace.push(type);
    sent.push(payload);
    if (receipts[type] === "failed") return new Response(JSON.stringify({ status: "failed", retcode: 100 }));
    return response(receipts[type] === "unknown" ? {} : { message_id: 90000 + sent.length });
  });
  const enterChannel = () => { channelActive = true; routeRevision++; };
  const service = new QqService({ repository, encrypt: async x => x, decrypt: async () => JSON.stringify(secrets),
    fetch: fetch as typeof globalThis.fetch, chat: regularChat, voiceInbound,
    handleInbound: async ({ text }) => {
      if (text === "/enter") { enterChannel(); return true; }
      return channelActive;
    },
    sceneImageInbound: createQqSceneImageInbound({
      isCommand: text => /^\/p(?:\s|$)/.test(text), prepare, chat, chatWithoutImage, cancel, start, wait, load, checkRoute,
      guardDispatch: (candidate, revision, snapshot) => async () => {
        await checkRoute(candidate, revision);
        if (snapshot.contextRevision !== contextRevision) throw new Error("context_changed");
      },
      guardPublication: (candidate, revision) => async () => { await checkRoute(candidate, revision); trace.push("publish"); },
    }, 10),
  });
  async function receive(text: string, messageId = 42, voice = false) {
    const raw = Buffer.from(JSON.stringify({ post_type: "message", message_type: "private", self_id: 10001, user_id: 20001,
      message_id: messageId, message: voice ? [{ type: "record", data: { file: "a".repeat(32), text } }] : text }));
    return service.receive(initial.hookId, raw, `sha1=${createHmac("sha1", secrets.webhookSecret).update(raw).digest("hex")}`);
  }
  return { startSession: () => service.start(initial.userId, initial.generation), stopSession: () => service.stop(initial.userId, initial.generation),
    idle: () => service.waitForIdle(initial.userId), receive, trace, sent, keys, receipts, start, prepare, chat, wait, load, jobStarted,
    beforeDispatch, enterChannel, regularChat, voiceInbound, finishDelivery, chatWithoutImage, cancel, request, changeContext: () => { contextRevision++; } };
}

async function bounded<T>(work: Promise<T>, milliseconds = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("测试等待超时")), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

describe("QQ 显式场景配图", () => {
  it("只为已确认送达的文字创建一份图片任务，并分别占用稳定交付键", async () => {
    const f = fixture(); await f.startSession();
    expect(await f.receive("/p 灯塔")).toEqual({ accepted: true, duplicate: false });
    expect(await f.receive("/p 灯塔")).toEqual({ accepted: false, duplicate: true });
    await f.idle();
    expect(f.trace).toEqual(["text", "start", "publish", "image"]);
    expect(f.sent).toEqual(["继续记录灯塔情节。", [{ type: "image", data: { file: `base64://${image.toString("base64")}` } }]]);
    expect(Array.from(f.keys.keys())).toEqual(["inbound:10001:20001:42", "inbound:10001:20001:42:scene-image"]);
    const op = qqSceneImageOperationId(initial, "42");
    expect(op).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(qqSceneImageOperationId({ ...initial, userId: 4 }, "42")).not.toBe(op);
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.prepare).toHaveBeenCalledWith(expect.objectContaining({ operationId: op, personaId: 3, channel: "qq" }));
    expect(f.chat).toHaveBeenCalledWith(expect.objectContaining({ personaId: 3 }), { contextRevision: 12, sceneId: 7 }, "灯塔", expect.any(AbortSignal));
    expect(f.finishDelivery).toHaveBeenCalledWith(2, 1, "confirmed", "90001", "confirmed_by_api");
    expect(f.finishDelivery).toHaveBeenCalledWith(2, 2, "confirmed", "90002", "confirmed_by_api");
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it.each(["failed", "unknown", "已有占位"])("文字回执为 %s 时不启动图片任务", async mode => {
    const f = fixture(); await f.startSession();
    if (mode === "已有占位") f.keys.set("inbound:10001:20001:42", 11);
    else f.receipts.text = mode;
    await f.receive("/p 灯塔"); await f.idle();
    expect(f.trace).toEqual(mode === "已有占位" ? [] : ["text"]);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.cancel).toHaveBeenCalledWith(2, qqSceneImageOperationId(initial, "42"));
  });

  it.each(["中途错误", "缺少完成事件", "完成但正文为空", "生成器抛错"])("聊天%s时不确认部分正文，并取消已预留配图", async mode => {
    const f = fixture(); await f.startSession();
    const partial: ChatEvent = { type: "delta", text: "部分正文" };
    if (mode === "中途错误") f.chat.mockResolvedValue(chatEvents(partial, { type: "error" }, { type: "done" }));
    if (mode === "缺少完成事件") f.chat.mockResolvedValue(chatEvents(partial));
    if (mode === "完成但正文为空") f.chat.mockResolvedValue(chatEvents({ type: "delta", text: "   " }, { type: "done" }));
    if (mode === "生成器抛错") {
      const broken = async function* () { yield partial; throw new Error("模拟流中断"); };
      f.chat.mockResolvedValue(broken());
    }
    await f.receive("/p 灯塔"); await f.idle();
    expect(f.sent).toEqual([]);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledWith(2, qqSceneImageOperationId(initial, "42"));
  });

  it("预留后切换频道时取消配图占位，且不开始聊天", async () => {
    const f = fixture(); await f.startSession();
    f.prepare.mockImplementationOnce(async () => {
      f.enterChannel();
      return { requested: true, request: f.request, message: "灯塔" };
    });
    await f.receive("/p 灯塔"); await f.idle();
    expect(f.chat).not.toHaveBeenCalled();
    expect(f.sent).toEqual([]);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledWith(2, qqSceneImageOperationId(initial, "42"));
  });

  it("文字已确认但图片任务启动失败时取消占位", async () => {
    const f = fixture(); await f.startSession();
    f.start.mockRejectedValueOnce(new Error("模拟启动异常"));
    await f.receive("/p 灯塔"); await f.idle();
    expect(f.sent).toEqual(["继续记录灯塔情节。"]);
    expect(f.load).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledWith(2, qqSceneImageOperationId(initial, "42"));
  });

  it("图片回执未知时保留未知记录，事件重投不再生图或发送", async () => {
    const f = fixture(); await f.startSession(); f.receipts.image = "unknown";
    await f.receive("/p 灯塔"); await f.idle();
    expect(await f.receive("/p 灯塔")).toEqual({ accepted: false, duplicate: true });
    await f.idle();
    expect(f.trace).toEqual(["text", "start", "publish", "image"]);
    expect(f.finishDelivery).toHaveBeenCalledWith(2, 2, "unknown", null, "unconfirmed_response");
  });

  it("图片等待不阻塞频道切换，路由取消后迟到的成功图不读取、不发送", async () => {
    const f = fixture(); await f.startSession();
    const late = deferred<JobResult>();
    const enteredWait = deferred<AbortSignal>();
    const observedAbort = deferred<void>();
    f.wait.mockImplementation(async (_user, _id, signal) => {
      if (signal.aborted) observedAbort.resolve();
      else signal.addEventListener("abort", () => observedAbort.resolve(), { once: true });
      enteredWait.resolve(signal);
      return late.promise;
    });
    try {
      await f.receive("/p 灯塔");
      const signal = await bounded(enteredWait.promise);
      await f.receive("/enter", 43);
      await bounded(observedAbort.promise);
      expect(signal.aborted).toBe(true);
    } finally {
      late.resolve({ status: "succeeded", outputKey });
      await f.idle();
    }
    expect(f.trace).toEqual(["text", "start", "publish"]);
    expect(f.load).not.toHaveBeenCalled();
    expect(f.keys.has("inbound:10001:20001:42:scene-image")).toBe(false);
  });

  it("QQ 停用直接取消图片任务信号，旧任务结果不能进入投递", async () => {
    const f = fixture(); await f.startSession();
    const pending = deferred<JobResult>();
    const enteredWait = deferred<AbortSignal>();
    f.wait.mockImplementation(async (_user, _id, signal) => { enteredWait.resolve(signal); return pending.promise; });
    try {
      await f.receive("/p 灯塔");
      const signal = await bounded(enteredWait.promise);
      await f.stopSession();
      expect(signal.aborted).toBe(true);
    } finally {
      pending.resolve({ status: "succeeded", outputKey });
      await f.idle();
    }
    expect(f.load).not.toHaveBeenCalled();
    expect(f.sent).toEqual(["继续记录灯塔情节。"]);
  });

  it.each(["当前未配置场景配图。", "当前没有启用的图片接口。", "配图次数已达上限。"])("%s 时用已清理的正文走文字回退", async errorMessage => {
    const f = fixture(); await f.startSession();
    f.prepare.mockResolvedValue({ ...f.request, requested: true, message: "灯塔", errorMessage });
    await f.receive("/p 灯塔"); await f.idle();
    expect(f.chatWithoutImage).toHaveBeenCalledWith(expect.objectContaining({ personaId: 3 }), { contextRevision: 12, sceneId: 7 }, "灯塔", expect.any(AbortSignal));
    expect(f.sent).toEqual([`保留文字叙事。\n\n（${errorMessage}）`]);
    expect(f.finishDelivery).toHaveBeenCalledWith(2, 1, "confirmed", "90001", "confirmed_by_api");
    expect(f.chat).not.toHaveBeenCalled();
    expect(f.regularChat).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it("未取得场景快照时不在新场景中发送回退正文", async () => {
    const f = fixture(); await f.startSession();
    f.prepare.mockResolvedValue({ requested: true, message: "灯塔", errorMessage: "配图暂不可用。" });
    await f.receive("/p 灯塔"); await f.idle();
    expect(f.chatWithoutImage).not.toHaveBeenCalled();
    expect(f.sent).toEqual([]);
  });

  it("文字回退派发前仍核对原上下文版本", async () => {
    const f = fixture(); await f.startSession();
    f.prepare.mockResolvedValue({ ...f.request, sceneId: null, requested: true, message: "灯塔", errorMessage: "配图暂不可用。" });
    f.beforeDispatch.mockImplementationOnce(f.changeContext);
    await f.receive("/p 灯塔"); await f.idle();
    expect(f.chatWithoutImage).toHaveBeenCalledWith(expect.objectContaining({ personaId: 3 }), { contextRevision: 12, sceneId: null }, "灯塔", expect.any(AbortSignal));
    expect(f.sent).toEqual([]);
    expect(f.finishDelivery).toHaveBeenCalledWith(2, 1, "failed", null, "dispatch_rejected");
    expect(f.start).not.toHaveBeenCalled();
  });

  it("文字回退中断时不发送部分正文，也不启动或取消未预留的图片", async () => {
    const f = fixture(); await f.startSession();
    f.prepare.mockResolvedValue({ ...f.request, requested: true, message: "灯塔", errorMessage: "配图暂不可用。" });
    f.chatWithoutImage.mockResolvedValue(chatEvents({ type: "delta", text: "部分正文" }, { type: "error" }));
    await f.receive("/p 灯塔"); await f.idle();
    expect(f.sent).toEqual([]);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it.each([true, false])("危机回复只发送原文字，图片是否已预留：%s", async reserved => {
    const f = fixture(); await f.startSession();
    const crisis = chatEvents({ type: "delta", text: "请先联系能当面陪伴你的人。" }, { type: "done", crisis: true });
    if (reserved) f.chat.mockResolvedValue(crisis);
    else {
      f.prepare.mockResolvedValue({ ...f.request, requested: true, message: "灯塔", errorMessage: "配图暂不可用。" });
      f.chatWithoutImage.mockResolvedValue(crisis);
    }
    await f.receive("/p 灯塔"); await f.idle();
    expect(f.sent).toEqual(["请先联系能当面陪伴你的人。"]);
    expect(f.finishDelivery).toHaveBeenCalledWith(2, 1, "confirmed", "90001", "confirmed_by_api");
    expect(f.start).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    if (reserved) expect(f.cancel).toHaveBeenCalledWith(2, qqSceneImageOperationId(initial, "42"));
    else expect(f.cancel).not.toHaveBeenCalled();
  });

  it("图片投递占键后再次核对频道；若已切换则不开始网络发送", async () => {
    const f = fixture(); await f.startSession();
    f.beforeDispatch.mockImplementation(() => { if (f.keys.size === 2) f.enterChannel(); });
    await f.receive("/p 灯塔"); await f.idle();
    expect(f.trace).toEqual(["text", "start", "publish"]);
    expect(f.finishDelivery).toHaveBeenCalledWith(2, 2, "failed", null, "dispatch_rejected");
  });

  it("普通文字、语音段和频道内的文字保持原路由", async () => {
    const f = fixture(); await f.startSession();
    await f.receive("普通文字 /person");
    await f.receive("/p 语音内容", 43, true);
    await f.receive("/enter", 44);
    await f.receive("/p 频道内容", 45);
    await f.idle();
    expect(f.regularChat).toHaveBeenCalledTimes(1);
    expect(f.voiceInbound).toHaveBeenCalledTimes(1);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.trace).toEqual(["text"]);
  });
});
