import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { summarizeQqDeliveryParts, type QqDeliveryPart } from "../../../shared/qq-delivery";
import type { DbTransaction } from "../../db";
import { getCurrentWebChannelAdvanceTask, startWebChannelAdvance, stopWebChannelAdvance } from "../../social/web-channel-advance";
import { QqError, type DeliveryResult, type QqConfig } from "./core";
import { parseQqRoleplayCommand, splitQqRoleplayBeat } from "./roleplay-core";
import { QqRoleplayService, type QqRoleplayDependencies } from "./roleplay-service";
import type { QqRoleplayBatchRecord, QqRoleplayBeatInput, QqRoleplayRepository, QqRoleplayTicket } from "./roleplay-types";

vi.mock("../../db", () => ({}));
vi.mock("../../social/roleplay-channel", () => ({ runRoleplayChannelTurn: vi.fn() }));

const transaction = {} as DbTransaction;
const beat = { messageId: 15, speakerName: "旅人", personaId: 21, replyText: "【潮汐退去】岸上还有一盏灯。", innerThought: "只保留在网页的心声", emotionalState: "warm" as const };
const confirmation = (id: string): DeliveryResult => ({ status: "confirmed", remoteMessageId: id, reason: "confirmed_by_api" });
let nextUser = 70000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(generate?: QqRoleplayDependencies["generate"], initiallyBound = true) {
  const userId = nextUser++;
  const channel = { id: 7, name: "海岸", isActive: true, channelKind: "channel", generationRevision: 2 };
  const config: QqConfig = { id: 2, userId, hookId: "synthetic", apiBaseUrl: "http://localhost", botId: "8", targetId: "9", personaId: 21, secretsEnc: "synthetic", enabled: true, generation: 3 };
  const ticket: QqRoleplayTicket = { userId, configId: config.id, configGeneration: config.generation, botId: config.botId, targetId: config.targetId, channelId: channel.id, routeRevision: 1, channelRevision: channel.generationRevision };
  let route: QqRoleplayTicket | null = initiallyBound ? ticket : null;
  let saved: QqRoleplayBatchRecord | undefined;
  const session = new AbortController();
  const send = vi.fn(async (_text: string, _signal?: AbortSignal) => confirmation("1"));
  const prepare = vi.fn(async (_owner: number) => ({ config, signal: session.signal, send }));
  const note = vi.fn(async (_ticket: QqRoleplayTicket, _text: string) => {
    channel.generationRevision++;
    if (route) route = { ...route, channelRevision: channel.generationRevision };
  });
  const actualGenerate = generate ?? vi.fn(async () => { throw new Error("不应调用模型"); });
  const refresh = () => {
    if (saved) saved.batch.summary = summarizeQqDeliveryParts(saved.batch.parts);
  };
  function getSaved() {
    if (!saved) throw new Error("缺少合成交付批次");
    return saved;
  }
  const repository: QqRoleplayRepository = {
    getRoute: vi.fn(async owner => owner === userId ? route : null),
    setRoute: vi.fn(async (_config, channelId) => route = channelId === null ? null : { ...ticket, channelId }),
    validateRoute: vi.fn(async (_tx, expected) => {
      if (route !== expected) throw new QqError("PRECONDITION_FAILED", "路由已变更");
    }),
    createBeat: vi.fn(async (_tx, snapshot, input: QqRoleplayBeatInput) => {
      const parts: QqDeliveryPart[] = input.texts.map((text, partIndex) => ({
        id: `${input.beatIndex}:${partIndex}`, messageId: input.messageId, beatIndex: input.beatIndex, partIndex, text, status: "pending", attempts: 0,
      }));
      saved = { ticket: snapshot, activeOperationId: input.operationId, batch: {
        id: randomUUID(), version: 1, channelId: snapshot.channelId, userId, contactId: "private:9", source: input.source,
        createdAt: "2000-01-01", updatedAt: "2000-01-01", parts, summary: summarizeQqDeliveryParts(parts),
      } };
      return saved;
    }),
    recent: vi.fn(async (owner, channelId) => saved && owner === userId && channelId === channel.id ? [saved] : []),
    get: vi.fn(async (owner, channelId, batchId) => {
      const record = getSaved();
      if (owner !== userId || channelId !== channel.id || batchId !== record.batch.id) throw new QqError("NOT_FOUND", "批次不存在");
      return record;
    }),
    beginRetry: vi.fn(async input => {
      const record = getSaved();
      if (record.activeOperationId === input.operationId) return { record, started: false };
      if (record.batch.version !== input.expectedVersion) throw new QqError("CONFLICT", "批次版本已变更");
      if (record.batch.summary.unknown && !input.allowUnknown) throw new QqError("PRECONDITION_FAILED", "必须确认重复风险");
      if (!route) throw new QqError("PRECONDITION_FAILED", "路由已停用");
      record.activeOperationId = input.operationId;
      record.ticket = route;
      record.batch.version++;
      return { record, started: true };
    }),
    reserveAttempt: vi.fn(async (_ticket, _batch, partId) => {
      const part = getSaved().batch.parts.find(item => item.id === partId)!;
      part.attempts++;
      return partId;
    }),
    async dispatchAttempt(_ticket, _batch, _part, _attempt, start) {
      return { result: start() };
    },
    finishAttempt: vi.fn(async (_owner, attempt, result) => {
      const part = getSaved().batch.parts.find(item => item.id === attempt)!;
      part.status = result.status === "confirmed" ? "sent" : part.status === "unknown" ? "unknown" : result.status;
      if (result.remoteMessageId) part.qqMessageId = result.remoteMessageId;
      refresh();
    }),
    cancelPending: vi.fn(async () => {
      for (const part of getSaved().batch.parts) if (part.status === "pending") part.status = "cancelled";
      refresh();
    }),
  };
  const service = new QqRoleplayService({
    repository,
    prepare,
    listChannels: async owner => owner === userId ? [channel, { ...channel, id: 8, name: "对戏", channelKind: "duet" }] : [],
    getChannel: async (id, owner) => id === channel.id && owner === userId ? channel : undefined,
    writeNote: note,
    generate: actualGenerate,
  });
  const reply = vi.fn(async (_text: string) => {});
  return { userId, channel, config, ticket, service, repository, session, prepare, send, reply, note, getSaved, generate: actualGenerate,
    inbound: (text: string, unsupportedMedia = false) => service.handleInbound({ config, messageId: "1", text, unsupportedMedia, signal: session.signal, reply }),
  };
}

async function saveBeat(f: ReturnType<typeof fixture>, source: "web" | "qq" = "web", signal = f.session.signal) {
  const hooks = await f.service.prepareTurn(f.userId, f.channel.id, randomUUID(), source, signal);
  if (!hooks) throw new Error("没有已授权频道");
  await hooks.beforeSave(transaction);
  await hooks.savedBeat(transaction, beat, 0);
  return hooks;
}

describe("QQ 角色频道指令", () => {
  it("解析编号、限定推进轮数并将普通文字与指令分开", () => {
    expect(parseQqRoleplayCommand("进入频道二十六")).toEqual({ kind: "enter", index: 26 });
    expect(parseQqRoleplayCommand("进入频道模式")).toEqual({ kind: "enter" });
    expect(parseQqRoleplayCommand("/R0")).toEqual({ kind: "stop" });
    expect(parseQqRoleplayCommand("/R")).toEqual({ kind: "advance", continuous: true, total: 50 });
    expect(parseQqRoleplayCommand("/r51")).toEqual({ kind: "invalid" });
    expect(parseQqRoleplayCommand("风向变了")).toBeNull();
  });

  it("只列普通频道，普通文字只写引导，退出后交回日常聊天", async () => {
    const f = fixture();
    await expect(f.inbound("频道列表")).resolves.toBe(true);
    expect(f.reply.mock.lastCall?.[0]).toContain("海岸");
    expect(f.reply.mock.lastCall?.[0]).not.toContain("对戏");
    await expect(f.inbound("潮水退去。")).resolves.toBe(true);
    expect(f.note).toHaveBeenCalledWith(f.ticket, "潮水退去。");
    expect(f.generate).not.toHaveBeenCalled();
    await f.inbound("退出频道");
    await expect(f.inbound("今天过得好吗？")).resolves.toBe(false);
    await f.inbound("进入频道模式");
    expect(f.repository.setRoute).toHaveBeenLastCalledWith(f.config, f.channel.id);
  });

  it("首次无编号进入时选择第一个可用普通频道，已在频道内时不改绑", async () => {
    const f = fixture(undefined, false);
    await expect(f.inbound("进入频道模式")).resolves.toBe(true);
    expect(f.repository.setRoute).toHaveBeenCalledWith(f.config, f.channel.id);
    await expect(f.inbound("进入频道模式")).resolves.toBe(true);
    expect(f.repository.setRoute).toHaveBeenCalledTimes(1);
  });

  it("频道与普通私聊分别提示入站媒体不可用，不解析附带指令或写剧情", async () => {
    const f = fixture();
    await expect(f.inbound("/R3", true)).resolves.toBe(true);
    expect(f.reply.mock.lastCall?.[0]).toContain("当前频道只支持文字");
    await f.inbound("退出频道");
    await expect(f.inbound("", true)).resolves.toBe(true);
    expect(f.reply.mock.lastCall?.[0]).toContain("普通私聊的入站图片和语音处理尚未启用");
    expect(f.note).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("引导写入后暂停原推进并提示继续方式，不停止写入期间登记的新任务", async () => {
    const f = fixture();
    const scope = { userId: f.userId, channelId: f.channel.id };
    const first = startWebChannelAdvance({ ...scope, generationRevision: f.channel.generationRevision, taskId: "fixture-page:1" });
    expect(first).not.toBeNull();
    await f.inbound("潮水退去。");
    expect(first?.signal.aborted).toBe(true);
    expect(f.reply.mock.lastCall?.[0]).toContain("引导已保存，当前推进已暂停");

    const second = startWebChannelAdvance({ ...scope, generationRevision: f.channel.generationRevision, taskId: "fixture-page:2" });
    const entered = deferred<void>();
    const release = deferred<void>();
    f.note.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    const incoming = f.inbound("海岸上亮起一盏灯。");
    try {
      await entered.promise;
      const newer = startWebChannelAdvance({ ...scope, generationRevision: f.channel.generationRevision, taskId: "fixture-page:3" });
      release.resolve();
      await incoming;
      expect(second?.signal.aborted).toBe(true);
      expect(newer?.signal.aborted).toBe(false);
      expect(getCurrentWebChannelAdvanceTask(f.channel.id, f.userId)).toBe(newer);
    } finally {
      release.resolve();
      await incoming;
      stopWebChannelAdvance(scope);
    }
  });

  it("启动后立即交回入站队列，停止不等待模型且信号确实取消模型", async () => {
    const modelEntered = deferred<AbortSignal>();
    const modelRelease = deferred<void>();
    const generate = vi.fn<NonNullable<QqRoleplayDependencies["generate"]>>(async options => {
      modelEntered.resolve(options.signal!);
      await modelRelease.promise;
      throw new Error("合成迟到响应");
    });
    const f = fixture(generate);
    try {
      await expect(f.inbound("/R3")).resolves.toBe(true);
      const signal = await modelEntered.promise;
      expect(f.service.status(f.userId, f.channel.id)).toMatchObject({ running: true, current: 0, total: 3 });
      await expect(f.inbound("/S")).resolves.toBe(true);
      expect(signal.aborted).toBe(true);
      expect(getCurrentWebChannelAdvanceTask(f.channel.id, f.userId)).toBeNull();
      expect(f.send).not.toHaveBeenCalled();
    } finally {
      modelRelease.resolve();
      await vi.waitFor(() => expect(f.service.status(f.userId, f.channel.id)).toBeNull());
    }
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("QQ 角色频道逐拍交付", () => {
  it("固定旁白和公开台词，长段不截断 Unicode 字符，也不发模型心声", () => {
    expect(splitQqRoleplayBeat(beat)).toEqual(["【潮汐退去】", "旅人：岸上还有一盏灯。"]);
    const text = "🌊".repeat(4100);
    const parts = splitQqRoleplayBeat({ speakerName: "旅人", replyText: text });
    expect(parts.map(value => Array.from(value).length)).toEqual([4000, 103]);
    expect(parts.join("")).toBe(`旅人：${text}`);
  });

  it("超过 32 个传输分段时报错，避免绕过仓储上限", () => {
    const replyText = "潮".repeat(32 * 4000 - 3);
    expect(splitQqRoleplayBeat({ speakerName: "旅人", replyText })).toHaveLength(32);
    expect(() => splitQqRoleplayBeat({ speakerName: "旅人", replyText: replyText + "水" })).toThrow(QqError);
  });

  it("提交原文前不发请求；无编号成功为未知并阻止后段和后续拍", async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce({ status: "confirmed", remoteMessageId: null, reason: "upstream" });
    const hooks = await saveBeat(f);
    expect(f.send).not.toHaveBeenCalled();
    await expect(hooks.afterBeat(beat)).resolves.toBe(false);
    expect(f.send.mock.calls.map(([text]) => text)).toEqual(["【潮汐退去】"]);
    expect(hooks.readResult()).toMatchObject({ qqDelivery: [{ summary: { unknown: 1, pending: 1 } }], qqDeliveryError: expect.any(String) });
    await expect(f.service.prepareTurn(f.userId, f.channel.id, randomUUID(), "web", f.session.signal)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("只在明确确认风险后按原文重发，并在同操作重复时不再次派发", async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce({ status: "unknown", remoteMessageId: null, reason: "transport_unconfirmed" });
    const hooks = await saveBeat(f);
    await hooks.afterBeat(beat);
    const { id: batchId, version: expectedVersion } = f.getSaved().batch;
    const input = { userId: f.userId, channelId: f.channel.id, batchId, expectedVersion, operationId: randomUUID() };
    await expect(f.service.retry(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.send).toHaveBeenCalledTimes(1);
    await expect(f.service.retry({ ...input, allowUnknown: true })).resolves.toMatchObject({ summary: { sent: 2 } });
    await expect(f.service.retry({ ...input, allowUnknown: true })).resolves.toMatchObject({ summary: { sent: 2 } });
    expect(f.send.mock.calls.map(([text]) => text)).toEqual(["【潮汐退去】", "【潮汐退去】", "旅人：岸上还有一盏灯。"]);
  });

  it("同一绑定下引导更新频道版本，未完成交付仍暂停推进，并可用当前版本显式重发", async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce({ status: "unknown", remoteMessageId: null, reason: "transport_unconfirmed" });
    const hooks = await saveBeat(f);
    await hooks.afterBeat(beat);
    const { id: batchId, version: expectedVersion } = f.getSaved().batch;
    await f.inbound("远处出现一艘船。");
    expect(f.channel.generationRevision).toBe(f.ticket.channelRevision + 1);
    await expect(f.service.prepareTurn(f.userId, f.channel.id, randomUUID(), "web", f.session.signal))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("未完成的交付") });
    await f.inbound("/R1");
    expect(f.reply.mock.lastCall?.[0]).toContain("暂停推进");
    expect(f.generate).not.toHaveBeenCalled();
    const input = { userId: f.userId, channelId: f.channel.id, batchId, expectedVersion, operationId: randomUUID(), allowUnknown: true };
    await expect(f.service.retry(input)).resolves.toMatchObject({ summary: { sent: 2 } });
    expect(f.repository.reserveAttempt).toHaveBeenLastCalledWith(expect.objectContaining({ channelRevision: f.channel.generationRevision }), batchId, "0:1", input.operationId);
  });

  it("不能重发的历史未知批次仍可查询，但不阻挡同一绑定的新推进", async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce({ status: "unknown", remoteMessageId: null, reason: "transport_unconfirmed" });
    const hooks = await saveBeat(f);
    await hooks.afterBeat(beat);
    f.getSaved().batch.retryable = false;
    await expect(f.service.prepareTurn(f.userId, f.channel.id, randomUUID(), "web", f.session.signal))
      .resolves.toMatchObject({ beforeSave: expect.any(Function) });
    await expect(f.service.deliveries(f.userId, f.channel.id))
      .resolves.toMatchObject({ batches: [{ retryable: false, summary: { unknown: 1 } }] });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("网页镜像未连接时只保存当前拍和待发批次，直到人工处理前不占发送尝试", async () => {
    const f = fixture();
    f.prepare.mockRejectedValueOnce(new QqError("PRECONDITION_FAILED", "QQ 接口尚未验证连接。"));
    const hooks = await saveBeat(f);
    await expect(hooks.afterBeat(beat)).resolves.toBe(false);
    expect(f.repository.createBeat).toHaveBeenCalledTimes(1);
    expect(f.repository.reserveAttempt).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(hooks.readResult()).toMatchObject({ qqDelivery: [{ summary: { pending: 2 } }], qqDeliveryError: expect.stringContaining("QQ 尚未连接") });
  });

  it("QQ 发起仍要求连接，网页不会把程序异常或取消当成离线", async () => {
    const f = fixture();
    const offline = new QqError("PRECONDITION_FAILED", "QQ 接口尚未验证连接。");
    const prepare = (source: "qq" | "web") => f.service.prepareTurn(f.userId, f.channel.id, randomUUID(), source, f.session.signal);
    f.prepare.mockRejectedValueOnce(offline);
    await expect(prepare("qq")).rejects.toBe(offline);
    const aborted = new DOMException("已取消", "AbortError");
    f.prepare.mockRejectedValueOnce(aborted);
    await expect(prepare("web")).rejects.toBe(aborted);
    const bug = new Error("合成异常");
    f.prepare.mockRejectedValueOnce(bug);
    await expect(prepare("web")).rejects.toBe(bug);
    expect(f.repository.createBeat).not.toHaveBeenCalled();
  });

  it("派发前停止只取消待发段，不调用传输", async () => {
    const f = fixture();
    const controller = new AbortController();
    const hooks = await saveBeat(f, "web", controller.signal);
    controller.abort();
    await expect(hooks.afterBeat(beat)).resolves.toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    expect(hooks.readResult().qqDelivery[0].summary).toMatchObject({ cancelled: 2 });
  });
});
