import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { apiBase, deliveryResult, parseInbound, plainText, QqError, verifyWebhook, type QqConfig, type QqDelivery, type QqSecrets } from "./core";
import type { QqRepository } from "./repository";
import { createQqRouter } from "./router";
import { QqService, type QqChatInput } from "./service";
import { QqMediaService } from "./media-service";
import type { QqRoleplayRepository } from "./roleplay-types";

const getDb = vi.hoisted(() => vi.fn(() => { throw new Error("QQ 单测禁止连接真实数据库。"); }));
vi.mock("../../db", () => ({ getDb, getFilesByPersonaId: vi.fn(), getRoleplayChannels: vi.fn(), getRoleplayChannelById: vi.fn() }));

const secrets: QqSecrets = { apiToken: "test-api-token", receiveToken: "test-receive-token", webhookSecret: "test-signing-secret" };
const sign = (raw: Buffer, secret = secrets.webhookSecret) => `sha1=${createHmac("sha1", secret).update(raw).digest("hex")}`;
const authorization = `Bearer ${secrets.receiveToken}`;
it("第6A的通用适配器拒绝管理员通知等主动外发入口", async () => {
  const { qqAdapter, qqService } = await import("./index");
  const send = vi.spyOn(qqService, "send");
  try {
    await expect(qqAdapter.send(1, "private:20001", "主动消息")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(send).not.toHaveBeenCalled();
  } finally { send.mockRestore(); }
});
function event(patch: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({ post_type: "message", message_type: "private", self_id: 10001, user_id: 20001,
    message_id: 42, message: [{ type: "text", data: { text: "请读这段故事。" } }], ...patch }));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const login = (id = 10001) => new Response(JSON.stringify({ status: "ok", retcode: 0, data: { user_id: id } }));

function fixture() {
  const configs = new Map<number, QqConfig>();
  configs.set(1, { id: 1, userId: 1, hookId: "a".repeat(48), apiBaseUrl: "https://bot.example.invalid", botId: "10001",
    targetId: "20001", personaId: 11, secretsEnc: `fake:${JSON.stringify(secrets)}`, enabled: false, generation: 1 });
  const inbound = new Set<string>();
  const deliveryRows: (QqDelivery & { userId: number; configId: number; key: string })[] = [];
  const inboundStatuses: string[] = [];
  const ownedPersonas = new Map([[1, 11], [2, 22]]);
  const controls: { beforeClaim?: () => Promise<void>; beforeDispatch?: () => Promise<void>; failDispatchAfterStart?: boolean; failSettlement?: boolean } = {};
  function version(userId: number, expected: number | null) {
    const row = configs.get(userId);
    if ((row?.generation ?? null) !== expected) throw new QqError("CONFLICT", "配置已变更。");
    return row;
  }
  function active(config: QqConfig) {
    const row = configs.get(config.userId);
    if (!row?.enabled || row.generation !== config.generation || row.id !== config.id) throw new QqError("PRECONDITION_FAILED", "已停用。");
  }
  const repository: QqRepository = {
    get: vi.fn(async userId => { const row = configs.get(userId); return row ? { ...row } : null; }),
    byHook: vi.fn(async hook => { const row = Array.from(configs.values()).find(item => item.hookId === hook); return row ? { ...row } : null; }),
    save: vi.fn(async (userId, expected, fields) => {
      const old = version(userId, expected);
      if (fields.personaId !== ownedPersonas.get(userId)) throw new QqError("FORBIDDEN", "角色不属于当前账号。");
      const row: QqConfig = { ...fields, userId, id: old?.id ?? userId, hookId: old?.hookId ?? String(userId).repeat(48), enabled: false, generation: (old?.generation ?? 0) + 1 };
      configs.set(userId, row);
      return { ...row };
    }),
    enable: vi.fn(async (userId, expected) => {
      const row = version(userId, expected)!;
      if (row.personaId !== ownedPersonas.get(userId)) throw new QqError("FORBIDDEN", "角色不属于当前账号。");
      if (Array.from(configs.values()).some(other => other.userId !== userId && other.enabled && other.botId === row.botId && other.targetId === row.targetId)) throw new QqError("CONFLICT", "目标已绑定。");
      row.enabled = true;
      return { ...row };
    }),
    disable: vi.fn(async (userId, expected) => {
      const row = version(userId, expected);
      if (row) { row.enabled = false; row.generation++; }
    }),
    claimInbound: vi.fn(async (config, messageId) => {
      await controls.beforeClaim?.();
      active(config);
      const key = `${config.id}:${config.botId}:${config.targetId}:${messageId}`;
      if (inbound.has(key)) return null;
      inbound.add(key);
      return inbound.size;
    }),
    finishInbound: vi.fn(async (_config, _id, status) => { inboundStatuses.push(status); }),
    claimDelivery: vi.fn(async (config, key) => {
      active(config);
      if (deliveryRows.some(row => row.configId === config.id && row.key === key)) return null;
      const id = deliveryRows.length + 1;
      deliveryRows.push({ id, userId: config.userId, configId: config.id, key, targetId: config.targetId,
        status: "unknown", remoteMessageId: null, reason: "dispatch_pending", createdAt: new Date() });
      return id;
    }),
    async dispatchDelivery(config, id, start, guard) {
      await controls.beforeDispatch?.();
      active(config);
      await guard?.({} as never);
      const row = deliveryRows.find(item => item.id === id && item.userId === config.userId);
      if (!row || row.reason !== "dispatch_pending") throw new QqError("CONFLICT", "投递占位已使用。");
      const result = start();
      void result.catch(() => {});
      if (controls.failDispatchAfterStart) throw new Error("合成事务提交失败");
      row.reason = "dispatch_started";
      return { result };
    },
    finishDelivery: vi.fn(async (userId, id, status, remoteMessageId, reason) => {
      if (controls.failSettlement) throw new Error("合成结算失败");
      const row = deliveryRows.find(item => item.id === id && item.userId === userId);
      if (row) Object.assign(row, { status, remoteMessageId, reason });
    }),
    recentDeliveries: vi.fn(async userId => deliveryRows.filter(row => row.userId === userId).map(({ userId: _owner, configId: _config, key: _key, ...row }) => row)),
  };
  const fetchMock = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => String(url).endsWith("/get_login_info")
    ? login() : new Response(JSON.stringify({ status: "ok", retcode: 0, data: { message_id: 84 } })));
  const chat = vi.fn(async (_input: QqChatInput): Promise<string | null> => "让我们继续阅读这段故事。");
  const encrypt = vi.fn(async (text: string) => `fake:${text}`);
  const service = new QqService({ repository, encrypt, decrypt: async text => text.startsWith("fake:") ? text.slice(5) : null,
    fetch: fetchMock as typeof fetch, chat, timeoutMs: 30 });
  const start = (userId = 1) => service.start(userId, configs.get(userId)?.generation ?? null);
  const stop = (userId = 1) => service.stop(userId, configs.get(userId)?.generation ?? null);
  const receive = (raw = event(), hookId = configs.get(1)!.hookId) => service.receive(hookId, raw, sign(raw), authorization);
  const dispatches = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/send_private_msg"));
  return { service, repository, configs, deliveryRows, inboundStatuses, fetchMock, chat, encrypt, controls, start, stop, receive, dispatches };
}

beforeEach(() => { getDb.mockClear(); });

describe("QQ 文字协议", () => {
  it("按原始字节验签，并独立验证可选入站令牌", () => {
    const raw = event();
    expect(verifyWebhook(raw, sign(raw), authorization, secrets)).toBe(true);
    expect(verifyWebhook(Buffer.concat([raw, Buffer.from(" ")]), sign(raw), authorization, secrets)).toBe(false);
    expect(verifyWebhook(raw, undefined, authorization, secrets)).toBe(false);
    expect(verifyWebhook(raw, sign(raw), "Bearer wrong", secrets)).toBe(false);
    expect(verifyWebhook(raw, sign(raw), undefined, { ...secrets, receiveToken: "" })).toBe(true);
  });

  it("规范化消息编号并拒绝非文字、群聊、伪造身份、超限及错误编码", () => {
    const config = fixture().configs.get(1)!;
    expect(parseInbound(event({ message_id: "00042" }), config)).toMatchObject({ messageId: "42" });
    for (const patch of [{ message_type: "group" }, { self_id: 10002 }, { user_id: 20002 }, { sender: { user_id: 20002 } },
      { message: [{ type: "image", data: { file: "image" } }] }, { message: "[CQ:image,file=x]" }, { message: "a".repeat(4001) }, { message: " " }]) {
      expect(() => parseInbound(event(patch), config)).toThrow(QqError);
    }
    expect(plainText("🌟".repeat(4000))).toHaveLength(8000);
    expect(() => parseInbound(Buffer.alloc(65537), config)).toThrow(QqError);
    expect(() => parseInbound(Buffer.from([0xff]), config)).toThrow(QqError);
  });

  it("允许自管接口地址，不允许内嵌凭据、查询密钥或非 HTTP 协议", () => {
    expect(apiBase("https://bot.example.invalid/api/")).toBe("https://bot.example.invalid/api");
    expect(apiBase("http://127.0.0.1:3001/")).toBe("http://127.0.0.1:3001");
    for (const url of ["file:///tmp/bot", "https://user:password@bot.example.invalid", "https://bot.example.invalid?token=x", "not a url"]) expect(() => apiBase(url)).toThrow(QqError);
  });

  it("只有明确成功且带有效消息编号才确认", () => {
    expect(deliveryResult({ status: "ok", retcode: 0, data: { message_id: "0001" } })).toMatchObject({ status: "confirmed", remoteMessageId: "1" });
    expect(deliveryResult({ status: "failed", retcode: 100 }).status).toBe("failed");
    for (const body of [null, {}, { status: "ok", retcode: 0 }, { status: "ok", retcode: 0, data: { message_id: "not-an-id" } }, { status: "async", retcode: 1 }]) expect(deliveryResult(body).status).toBe("unknown");
  });
});

describe("QQ 归属、版本与入站幂等", () => {
  it("默认关闭，恢复只探测已启用连接，启用验证真实返回的机器人身份", async () => {
    const f = fixture();
    expect((await f.service.read(1)).enabled).toBe(false);
    expect(await f.service.restore(1)).toBe(false);
    expect(f.fetchMock).not.toHaveBeenCalled();
    await expect(f.receive()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await f.start();
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    expect(String(f.fetchMock.mock.calls[0][0])).toBe("https://bot.example.invalid/get_login_info");
    expect((await f.service.read(1)).connected).toBe(true);
    expect(getDb).not.toHaveBeenCalled();
    const wrong = fixture();
    wrong.fetchMock.mockResolvedValue(login(10002));
    await expect(wrong.start()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(wrong.repository.enable).not.toHaveBeenCalled();
  });

  it("保存只写密文，空输入和掩码保留，坏密文可通过明确重填恢复", async () => {
    const f = fixture();
    const old = f.configs.get(1)!;
    const input = { ...old, expectedGeneration: 1, personaId: 11 };
    const view = await f.service.save(1, { ...input, apiToken: "", receiveToken: "••••••••", webhookSecret: "", clearApiToken: true });
    expect(view).toMatchObject({ enabled: false, generation: 2, apiTokenConfigured: false, receiveTokenConfigured: true, webhookSecretConfigured: true });
    expect(JSON.stringify(view)).not.toContain(secrets.webhookSecret);
    expect(JSON.stringify(view)).not.toContain(secrets.receiveToken);
    expect(f.encrypt).toHaveBeenCalled();
    expect(f.configs.get(1)!.secretsEnc).toMatch(/^fake:/);
    await expect(f.service.save(2, { ...input, expectedGeneration: null, webhookSecret: "new-signing-secret" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.configs.get(1)!.secretsEnc = "invalid-envelope";
    expect(await f.service.read(1)).toMatchObject({ credentialsUnreadable: true, connected: false });
    const recover = { ...input, expectedGeneration: 2, webhookSecret: "replacement-signing-secret" };
    await expect(f.service.save(1, recover)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await f.service.save(1, { ...recover, clearApiToken: true, clearReceiveToken: true })).toMatchObject({ generation: 3, credentialsUnreadable: false });
  });

  it("过期保存、启动、停止和改绑不取消当前连接；成功改绑才停用并换版本", async () => {
    const f = fixture();
    await f.start();
    const old = f.configs.get(1)!;
    await expect(f.service.save(1, { ...old, personaId: 11, expectedGeneration: null })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.service.start(1, null)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.service.stop(1, null)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.service.setDefaultPersona(1, 11, null)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.service.setDefaultPersona(1, 22, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await f.service.read(1)).toMatchObject({ enabled: true, connected: true, generation: 1 });
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    await f.service.setDefaultPersona(1, 11, 1);
    expect(await f.service.read(1)).toMatchObject({ enabled: false, connected: false, generation: 2 });
  });

  it("服务端 hook 决定归属；同事件并发和重启重放只调用一次聊天和发送", async () => {
    const f = fixture();
    await f.start();
    const raw = event({ userId: 2 });
    const replies = await Promise.all([f.receive(raw), f.receive(raw)]);
    expect(replies).toContainEqual({ accepted: true, duplicate: false });
    expect(replies).toContainEqual({ accepted: false, duplicate: true });
    await f.service.waitForIdle(1);
    const restarted = new QqService(f.service.dependencies);
    expect(await restarted.restore(1)).toBe(true);
    expect(await restarted.receive(f.configs.get(1)!.hookId, event({ message_id: "00042" }), sign(event({ message_id: "00042" })), authorization)).toEqual({ accepted: false, duplicate: true });
    expect(f.chat).toHaveBeenCalledTimes(1);
    expect(f.chat).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, personaId: 11, channel: "qq", signal: expect.any(AbortSignal) }));
    expect(f.dispatches()).toHaveLength(1);
    expect(f.deliveryRows[0]).toMatchObject({ userId: 1, status: "confirmed", remoteMessageId: "84" });
  });

  it("错误签名及未绑定机器人或目标在持久占键前拒绝", async () => {
    const f = fixture();
    await f.start();
    const raw = event();
    await expect(f.service.receive(f.configs.get(1)!.hookId, raw, sign(raw, "wrong"), authorization)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.receive(event({ self_id: 10002 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.receive(event({ user_id: 20002 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.repository.claimInbound).not.toHaveBeenCalled();
    expect(f.chat).not.toHaveBeenCalled();
  });

  it("不同目标可使用同一消息编号，不能绑定同一机器人和目标或向他人目标发送", async () => {
    const f = fixture();
    f.configs.set(2, { ...f.configs.get(1)!, id: 2, userId: 2, hookId: "b".repeat(48), personaId: 22, targetId: "20002" });
    await f.start(); await f.start(2);
    await f.receive(); await f.receive(event({ user_id: 20002 }), "b".repeat(48));
    await Promise.all([f.service.waitForIdle(1), f.service.waitForIdle(2)]);
    expect(f.chat).toHaveBeenCalledTimes(2);
    expect(await f.repository.recentDeliveries(2)).toMatchObject([{ targetId: "20002" }]);
    await expect(f.service.send(2, "private:20001", "你好。")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await f.stop(2);
    f.configs.get(2)!.targetId = "20001";
    await expect(f.start(2)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.dispatches()).toHaveLength(2);
  });

  it("异步占键期间也有 16 个队列名额，不接受超额事件", async () => {
    const f = fixture(); await f.start();
    const held = deferred<void>(); const entered = deferred<void>();
    let claims = 0;
    f.controls.beforeClaim = async () => { if (++claims === 16) entered.resolve(); await held.promise; };
    f.chat.mockResolvedValue(null);
    const results = Promise.allSettled(Array.from({ length: 20 }, (_, index) => f.receive(event({ message_id: index + 50 }))));
    await entered.promise;
    held.resolve();
    const settled = await results;
    expect(settled.filter(row => row.status === "fulfilled")).toHaveLength(16);
    for (const row of settled) if (row.status === "rejected") expect(row.reason).toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(f.repository.claimInbound).toHaveBeenCalledTimes(16);
    await f.service.waitForIdle(1);
    expect(f.chat).toHaveBeenCalledTimes(16);
  });

  it("停止时取消模型、阻止迟到回复及排队事件；已处理的入站不会因重启重发", async () => {
    const f = fixture(); const entered = deferred<AbortSignal>(); const reply = deferred<string>();
    f.chat.mockImplementation(async input => { entered.resolve(input.signal); return reply.promise; });
    await f.start(); await f.receive(); const signal = await entered.promise;
    await f.receive(event({ message_id: 43 })); await f.stop();
    expect(signal.aborted).toBe(true);
    reply.resolve("迟到的故事回复。"); await f.service.waitForIdle(1);
    expect(f.chat).toHaveBeenCalledTimes(1);
    expect(f.dispatches()).toHaveLength(0);
    expect(f.inboundStatuses).toEqual(["cancelled", "cancelled"]);
    await f.start();
    expect(await f.receive()).toEqual({ accepted: false, duplicate: true });
  });

  it("停用取消正在探测的连接，迟到身份回执不重新启用", async () => {
    const f = fixture(); const pending = deferred<Response>(); const entered = deferred<AbortSignal>();
    f.fetchMock.mockImplementation(async (_url, options) => { entered.resolve(options!.signal!); return pending.promise; });
    const outcome = expect(f.start()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const signal = await entered.promise;
    await f.stop(); expect(signal.aborted).toBe(true);
    pending.resolve(login()); await outcome;
    expect(f.repository.enable).not.toHaveBeenCalled();
    expect(f.configs.get(1)!.enabled).toBe(false);
  });
});

describe("QQ 出站确认与保守结算", () => {
  it.each([
    ["confirmed", { status: "ok", retcode: 0, data: { message_id: 99 } }],
    ["failed", { status: "failed", retcode: 100 }],
    ["unknown", { status: "async", retcode: 1 }],
    ["unknown", { status: "ok", retcode: 0, data: {} }],
  ] as const)("保存 %s，不因重复入站重新发送", async (expected, response) => {
    const f = fixture(); await f.start();
    f.fetchMock.mockImplementation(async () => new Response(JSON.stringify(response)));
    await f.receive(); await f.service.waitForIdle(1); await f.receive();
    expect(f.deliveryRows).toHaveLength(1);
    expect(f.deliveryRows[0].status).toBe(expected);
    expect(f.dispatches()).toHaveLength(1);
    const options = f.dispatches()[0][1]!;
    expect(options.redirect).toBe("error");
    expect(options.headers).toMatchObject({ Authorization: `Bearer ${secrets.apiToken}` });
    expect(JSON.parse(String(options.body))).toEqual({ user_id: 20001, message: "让我们继续阅读这段故事。", auto_escape: true });
    expect(options.body).not.toContain(secrets.receiveToken);
    expect(options.body).not.toContain(secrets.webhookSecret);
  });

  it("停用发生在派发闸门前时不会发起请求，明确记录未派发失败", async () => {
    const f = fixture(); const entered = deferred<void>(); const release = deferred<void>();
    await f.start();
    f.controls.beforeDispatch = async () => { entered.resolve(); await release.promise; };
    await f.receive(); await entered.promise;
    await f.stop(); release.resolve(); await f.service.waitForIdle(1);
    expect(f.dispatches()).toHaveLength(0);
    expect(f.deliveryRows[0]).toMatchObject({ status: "failed", reason: "cancelled_before_dispatch" });
  });

  it("超时或派发后停止均为未知，明确取消请求且不重试", async () => {
    for (const stopAfterDispatch of [false, true]) {
      const f = fixture(); const entered = deferred<AbortSignal>(); await f.start();
      f.fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        const signal = options!.signal!;
        signal.addEventListener("abort", () => reject(new Error("合成传输中断")), { once: true });
        entered.resolve(signal);
      }));
      await f.receive(); const signal = await entered.promise;
      if (stopAfterDispatch) await f.stop();
      await f.service.waitForIdle(1);
      expect(signal.aborted).toBe(true);
      expect(f.deliveryRows[0]).toMatchObject({ status: "unknown", reason: "transport_unconfirmed" });
      expect(f.dispatches()).toHaveLength(1);
    }
  });

  it("派发已启动但提交或结算失败时保留未知，不重新发送", async () => {
    for (const mode of ["commit", "settlement"]) {
      const f = fixture(); await f.start();
      f.controls.failDispatchAfterStart = mode === "commit";
      f.controls.failSettlement = mode === "settlement";
      await f.receive(); await f.service.waitForIdle(1);
      expect(await f.receive()).toEqual({ accepted: false, duplicate: true });
      expect(f.deliveryRows[0]).toMatchObject({ status: "unknown", remoteMessageId: null });
      expect(f.dispatches()).toHaveLength(1);
    }
  });

  it("网络异常、非成功 HTTP、损坏和超大回执保持未知且不泄露错误正文", async () => {
    const responses = [new Error("private network details"), new Response("private error", { status: 502 }), new Response("not-json"), new Response("x".repeat(32769))];
    for (const response of responses) {
      const f = fixture(); await f.start();
      f.fetchMock.mockImplementation(async () => { if (response instanceof Error) throw response; return response; });
      await expect(f.service.send(1, "private:20001", "你好。")).rejects.toThrow("投递结果未知");
      expect(f.deliveryRows[0]).toMatchObject({ status: "unknown", reason: "transport_unconfirmed" });
      expect(f.dispatches()).toHaveLength(1);
    }
  });
});

describe("QQ 受保护管理接口", () => {
  function caller(userId: number | null, service: QqService) {
    return createQqRouter(service).createCaller({ user: userId == null ? null : { id: userId }, req: { headers: {}, ip: "127.0.0.1" }, res: {} } as unknown as TrpcContext);
  }

  it("未登录不能读取、启动或停止", async () => {
    const f = fixture(); const api = caller(null, f.service);
    await expect(api.config()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.deliveries()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.start({ expectedGeneration: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.stop({ expectedGeneration: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(f.repository.get).not.toHaveBeenCalled();
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("管理归属来自登录会话，不能注入 userId，启动停止使用配置版本", async () => {
    const f = fixture(); const api = caller(2, f.service);
    const view = await api.save({ expectedGeneration: null, apiBaseUrl: "https://second.example.invalid", botId: "10002", targetId: "20002",
      personaId: 22, webhookSecret: "separate-secret", userId: 1 } as Parameters<typeof api.save>[0]);
    expect(view).toMatchObject({ botId: "10002", generation: 1, enabled: false });
    expect(f.configs.get(1)!.botId).toBe("10001");
    expect(JSON.stringify(view)).not.toContain("separate-secret");
    f.fetchMock.mockImplementation(async () => login(10002));
    expect(await api.start({ expectedGeneration: 1 })).toMatchObject({ connected: true, generation: 1 });
    await expect(api.stop({ expectedGeneration: null })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await api.stop({ expectedGeneration: 1 })).toMatchObject({ enabled: false, generation: 2 });
    expect(getDb).not.toHaveBeenCalled();
  });
});


describe("第6B入口与图片交付", () => {
  it("媒体通知先过验签归属并去重，不把媒体地址交给聊天", async () => {
    const f = fixture();
    f.service.dependencies.handleInbound = vi.fn(async input => {
      expect(input.unsupportedMedia).toBe(true);
      expect(input.text).toBe("");
      await input.reply("当前只接收普通文字。");
      return true;
    });
    await f.start();
    const raw = event({ message: [{ type: "image", data: { url: "https://private.invalid/secret" } }] });
    await f.receive(raw); await f.service.waitForIdle(1);
    await f.receive(raw); await f.service.waitForIdle(1);
    expect(f.service.dependencies.handleInbound).toHaveBeenCalledTimes(1);
    expect(f.chat).not.toHaveBeenCalled(); expect(f.dispatches()).toHaveLength(1);
    expect(JSON.stringify(f.dispatches())).not.toContain("private.invalid");
  });

  function mediaFixture() {
    const f = fixture();
    let inChannel = false;
    let routeRevision = 0;
    const route = { getRoute: vi.fn(async () => inChannel ? {} : null) } as unknown as QqRoleplayRepository;
    const data = Buffer.from("合成已校验图片");
    const assets = {
      list: vi.fn(async () => [{ id: 5, name: "图.png", size: data.length, sha256: "a".repeat(64) }]),
      load: vi.fn(async () => ({ id: 5, name: "图.png", size: data.length, sha256: "a".repeat(64), mime: "image/png" as const, data })),
    };
    const media = new QqMediaService(f.service, route, assets, async (_tx, _config, expectedRevision) => {
      if (expectedRevision !== routeRevision) throw new QqError("CONFLICT", "频道已变化。");
      if (inChannel) throw new QqError("PRECONDITION_FAILED", "频道中不可发图片。");
    }, async () => routeRevision);
    const input = { expectedGeneration: 1, assetId: 5, expectedSha256: "a".repeat(64), operationId: "a1111111-1111-4111-8111-111111111111" };
    return { ...f, media, assets, input, enter: () => { inChannel = true; routeRevision++; }, exit: () => { inChannel = false; routeRevision++; } };
  }

  it("只发送已核对的内存字节，相同操作换资产也不重复发送", async () => {
    const f = mediaFixture(); await f.start();
    expect(await f.media.send(1, f.input)).toMatchObject({ status: "confirmed", remoteMessageId: "84" });
    expect(await f.media.send(1, { ...f.input, assetId: 6, operationId: f.input.operationId.toUpperCase() })).toMatchObject({ status: "unknown", reason: "operation_already_processed" });
    expect(f.dispatches()).toHaveLength(1);
    const payload = JSON.parse(String(f.dispatches()[0][1]?.body));
    expect(payload.message).toEqual([{ type: "image", data: { file: `base64://${Buffer.from("合成已校验图片").toString("base64")}` } }]);
    expect(f.assets.load).toHaveBeenCalledWith(1, 11, 5, "a".repeat(64));
  });

  it("占位后进入频道或停用配置都在首次网络发送前拦截", async () => {
    for (const change of ["channel", "stop", "roundtrip"] as const) {
      const f = mediaFixture(); await f.start();
      f.controls.beforeDispatch = async () => { if (change === "stop") await f.stop(); else { f.enter(); if (change === "roundtrip") f.exit(); } };
      expect(await f.media.send(1, f.input)).toMatchObject({ status: "failed" });
      expect(f.dispatches()).toHaveLength(0);
    }
  });

  it("发送未知不换路径重发，重复操作保持一次网络请求", async () => {
    const f = mediaFixture(); await f.start();
    f.fetchMock.mockRejectedValue(new Error("合成断线"));
    expect(await f.media.send(1, f.input)).toMatchObject({ status: "unknown" });
    expect(await f.media.send(1, f.input)).toMatchObject({ status: "unknown" });
    expect(f.dispatches()).toHaveLength(1);
  });

  it("旧配置、频道模式和资产校验失败均不会占发送键", async () => {
    const f = mediaFixture(); await f.start();
    await expect(f.media.send(1, { ...f.input, expectedGeneration: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
    f.assets.load.mockRejectedValueOnce(new QqError("FORBIDDEN", "合成越权"));
    await expect(f.media.send(1, f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.enter();
    expect(await f.media.list(1)).toEqual({ available: false, blockedByChannel: true, assets: [] });
    await expect(f.media.send(1, f.input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.repository.claimDelivery).not.toHaveBeenCalled();
    expect(f.dispatches()).toHaveLength(0);
  });
});
