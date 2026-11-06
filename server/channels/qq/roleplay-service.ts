import { randomUUID } from "node:crypto";
import { summarizeQqDeliveryParts, type QqDeliveryBatch } from "../../../shared/qq-delivery";
import * as db from "../../db";
import { runRoleplayChannelTurn, type RoleplayTurnBeat, type RunRoleplayTurnOptions, type RunRoleplayTurnResult } from "../../social/roleplay-channel";
import * as advance from "../../social/web-channel-advance";
import { QqError, type DeliveryResult, type QqConfig } from "./core";
import {
  parseQqRoleplayCommand, qqRoleplayConfigMatches, QQ_ROLEPLAY_CHANNEL_PAGE, sameQqRoleplayRoute, splitQqRoleplayBeat,
} from "./roleplay-core";
import type { QqPreparedTransport, QqRoleplayBatchRecord, QqRoleplayRepository, QqRoleplayTicket } from "./roleplay-types";

type VersionedBatch = QqRoleplayBatchRecord["batch"];

export type QqRoleplayPreparedTurn = {
  signal: AbortSignal;
  beforeSave(tx: db.DbTransaction): Promise<void>;
  savedBeat(tx: db.DbTransaction, beat: RoleplayTurnBeat, beatIndex: number): Promise<void>;
  afterBeat(beat: RoleplayTurnBeat): Promise<boolean>;
  readResult(): { qqDelivery: VersionedBatch[]; qqDeliveryError?: string };
};

export type QqRoleplayAdvanceStatus = {
  channelId: number;
  running: boolean;
  current: number;
  total: number;
  continuous: boolean;
  lastSpeaker: string | null;
  startedAt: string;
};

type Channel = Pick<db.RoleplayChannelView, "id" | "name" | "isActive" | "channelKind" | "generationRevision">;
type Inbound = {
  config: QqConfig;
  messageId: string;
  text: string;
  unsupportedMedia?: boolean;
  signal: AbortSignal;
  reply(text: string): Promise<void>;
};
type RetryInput = { userId: number; channelId: number; batchId: string; operationId: string; expectedVersion: number; allowUnknown?: boolean };
type Loop = { ticket: QqRoleplayTicket; task: advance.WebChannelAdvanceTask; signal: AbortSignal; status: QqRoleplayAdvanceStatus };
type Flight = { channelId: number; controller: AbortController; batchId?: string };

export type QqRoleplayDependencies = {
  repository: QqRoleplayRepository;
  prepare(userId: number): Promise<QqPreparedTransport>;
  listChannels?(userId: number): Promise<Channel[]>;
  getChannel?(channelId: number, userId: number): Promise<Channel | undefined>;
  writeNote?(ticket: QqRoleplayTicket, text: string): Promise<void>;
  generate?(options: RunRoleplayTurnOptions & { delivery: QqRoleplayPreparedTurn }): Promise<RunRoleplayTurnResult>;
};

function staleRoute() {
  return new QqError("PRECONDITION_FAILED", "QQ 频道绑定已停用或变更，请重新进入频道。");
}

function publicChannel(channel: Channel | undefined): channel is Channel {
  return !!channel?.isActive && channel.channelKind === "channel";
}

function sameSnapshot(a: QqRoleplayTicket, b: QqRoleplayTicket) {
  return sameQqRoleplayRoute(a, b) && a.channelRevision === b.channelRevision;
}

function canRetry(batch: VersionedBatch) {
  return batch.retryable !== false && batch.summary.pending + batch.summary.failed + batch.summary.unknown > 0;
}

function safeTransportResult(result: DeliveryResult): DeliveryResult {
  if (result.status === "confirmed" && /^-?\d{1,40}$/.test(result.remoteMessageId ?? "")) {
    return { status: "confirmed", remoteMessageId: result.remoteMessageId, reason: "confirmed_by_api" };
  }
  if (result.status === "failed") return { status: "failed", remoteMessageId: null, reason: "rejected_by_api" };
  return { status: "unknown", remoteMessageId: null, reason: "transport_unconfirmed" };
}

export class QqRoleplayService {
  private readonly loops = new Map<number, Loop>();
  private readonly lastChannel = new Map<number, { configId: number; generation: number; channelId: number }>();
  private readonly flights = new Map<number, Flight>();
  private readonly sending = new Set<string>();
  private readonly repository: QqRoleplayRepository;
  private readonly listChannels: NonNullable<QqRoleplayDependencies["listChannels"]>;
  private readonly getChannel: NonNullable<QqRoleplayDependencies["getChannel"]>;
  private readonly writeNote: NonNullable<QqRoleplayDependencies["writeNote"]>;
  private readonly generate: NonNullable<QqRoleplayDependencies["generate"]>;

  constructor(private readonly dependencies: QqRoleplayDependencies) {
    this.repository = dependencies.repository;
    this.listChannels = dependencies.listChannels ?? (userId => db.getRoleplayChannels(userId));
    this.getChannel = dependencies.getChannel ?? ((channelId, userId) => db.getRoleplayChannelById(channelId, userId));
    this.generate = dependencies.generate ?? runRoleplayChannelTurn;
    this.writeNote = dependencies.writeNote ?? ((ticket, text) => db.withRoleplayBeatTransaction(async tx => {
      await this.repository.validateRoute(tx, ticket);
      await db.createRoleplayMessage({
        userId: ticket.userId, channelId: ticket.channelId, speakerName: "用户", role: "user",
        content: text, mode: "channel", turnKind: "user_note",
      }, undefined, tx);
    }));
  }

  private displayBatch(batch: VersionedBatch): VersionedBatch {
    const parts = batch.parts.map(part => this.sending.has(part.id)
      ? { ...part, status: "sending" as const } : part);
    return { ...batch, parts, summary: summarizeQqDeliveryParts(parts) };
  }

  async deliveries(userId: number, channelId: number) {
    if (!await this.getChannel(channelId, userId)) throw new QqError("NOT_FOUND", "频道不存在或无权访问。");
    return { channelId, batches: (await this.repository.recent(userId, channelId)).map(({ batch }) => this.displayBatch(batch)) };
  }

  status(userId: number, channelId: number): QqRoleplayAdvanceStatus | null {
    const loop = this.loops.get(userId);
    return loop?.ticket.channelId === channelId ? { ...loop.status, running: !loop.signal.aborted } : null;
  }

  async stop(userId: number, channelId: number): Promise<boolean> {
    const flight = this.flights.get(userId);
    const stoppingFlight = flight?.channelId === channelId && !flight.controller.signal.aborted;
    if (stoppingFlight) flight.controller.abort();
    const loop = this.loops.get(userId);
    const stoppingLoop = loop?.ticket.channelId === channelId && !loop.signal.aborted;
    // 通用无任务编号的停止也使先到、后完成权限查询的推进请求失效。
    const stopped = await advance.stopWebChannelAdvanceAndWait({ userId, channelId });
    return stopped || !!stoppingFlight || !!stoppingLoop;
  }

  private async prepareTransport(ticket: QqRoleplayTicket): Promise<QqPreparedTransport>;
  private async prepareTransport(ticket: QqRoleplayTicket, allowDisconnected: boolean): Promise<QqPreparedTransport | null>;
  private async prepareTransport(ticket: QqRoleplayTicket, allowDisconnected = false): Promise<QqPreparedTransport | null> {
    let transport: QqPreparedTransport;
    try {
      transport = await this.dependencies.prepare(ticket.userId);
    } catch (error) {
      if (allowDisconnected && error instanceof QqError && error.code === "PRECONDITION_FAILED") return null;
      throw error;
    }
    if (!qqRoleplayConfigMatches(ticket, transport.config) || transport.signal.aborted) throw staleRoute();
    return transport;
  }

  private takeFlight(userId: number, channelId: number, batchId?: string): Flight {
    if (this.flights.has(userId)) throw new QqError("CONFLICT", "当前账号正在进行 QQ 交付，请等待结算。");
    const flight = { channelId, controller: new AbortController(), batchId };
    this.flights.set(userId, flight);
    return flight;
  }

  private releaseFlight(userId: number, flight: Flight) {
    if (this.flights.get(userId) === flight) this.flights.delete(userId);
  }

  /** 逐段持久占键、发起及结算，停止只取消未发段，不能回收已发请求。 */
  private async sendBatch(record: QqRoleplayBatchRecord, transport: QqPreparedTransport, signal: AbortSignal, retry: boolean) {
    const { ticket, batch, activeOperationId } = record;
    const parts = [...batch.parts].sort((a, b) => a.beatIndex - b.beatIndex || a.partIndex - b.partIndex);
    for (const part of parts) {
      if (part.status === "sent" || part.status === "cancelled") continue;
      if (signal.aborted) break;
      if (part.status !== "pending" && !(retry && (part.status === "failed" || part.status === "unknown"))) return;
      const attemptId = await this.repository.reserveAttempt(ticket, batch.id, part.id, activeOperationId);
      if (attemptId === null) return;
      this.sending.add(part.id);
      let began = false;
      let result: DeliveryResult;
      try {
        const dispatch = await this.repository.dispatchAttempt(ticket, batch.id, part.id, attemptId, () => {
          signal.throwIfAborted();
          began = true;
          return transport.send(part.text, signal);
        });
        result = safeTransportResult(await dispatch.result);
      } catch {
        result = began
          ? { status: "unknown", remoteMessageId: null, reason: "transport_unconfirmed" }
          : { status: "failed", remoteMessageId: null, reason: signal.aborted ? "cancelled_before_dispatch" : "dispatch_rejected" };
      }
      try {
        await this.repository.finishAttempt(ticket.userId, attemptId, result);
      } finally {
        this.sending.delete(part.id);
      }
      if (result.status !== "confirmed") break;
    }
    if (signal.aborted) await this.repository.cancelPending(ticket.userId, ticket.channelId, batch.id);
  }

  async prepareTurn(
    userId: number, channelId: number, operationId: string, source: "web" | "qq", signal: AbortSignal,
    expectedTicket?: QqRoleplayTicket,
  ): Promise<QqRoleplayPreparedTurn | null> {
    const ticket = await this.repository.getRoute(userId);
    if (!ticket || ticket.userId !== userId || ticket.channelId !== channelId || (expectedTicket && !sameSnapshot(ticket, expectedTicket))) {
      if (source === "qq" || expectedTicket) throw staleRoute();
      return null;
    }
    if (this.flights.has(userId)) throw new QqError("CONFLICT", "当前账号正在进行 QQ 交付，请等待结算。");
    const recent = await this.repository.recent(userId, channelId);
    if (recent.some(({ ticket: previous, batch }) => sameQqRoleplayRoute(previous, ticket) && canRetry(batch))) {
      throw new QqError("PRECONDITION_FAILED", "QQ 有未完成的交付，已暂停推进；请先查看 QQ 交付卡。");
    }
    const transport = await this.prepareTransport(ticket, source === "web");
    const combinedSignal = transport ? AbortSignal.any([signal, transport.signal]) : signal;
    combinedSignal.throwIfAborted();
    const byMessageId = new Map<number, QqRoleplayBatchRecord>();
    const batches = new Map<string, VersionedBatch>();
    let qqDeliveryError: string | undefined;
    return {
      signal: combinedSignal,
      beforeSave: async tx => {
        combinedSignal.throwIfAborted();
        await this.repository.validateRoute(tx, ticket);
        combinedSignal.throwIfAborted();
      },
      savedBeat: async (tx, beat, beatIndex) => {
        combinedSignal.throwIfAborted();
        const texts = splitQqRoleplayBeat(beat);
        if (texts.length) {
          const record = await this.repository.createBeat(tx, ticket, { operationId, source, messageId: beat.messageId, beatIndex, texts });
          byMessageId.set(beat.messageId, record);
        }
      },
      afterBeat: async beat => {
        const record = byMessageId.get(beat.messageId);
        if (!record) return !combinedSignal.aborted;
        batches.set(record.batch.id, record.batch);
        let flight: Flight | undefined;
        try {
          if (!transport) {
            if (combinedSignal.aborted) {
              await this.repository.cancelPending(userId, channelId, record.batch.id);
              const { batch } = await this.repository.get(userId, channelId, record.batch.id);
              batches.set(batch.id, batch);
              qqDeliveryError = "QQ 推进已停止，已保存的剧情保留。";
            } else {
              qqDeliveryError = "剧情已保存，QQ 尚未连接，已暂停后续推进；连接后在交付卡重发，或停用 QQ 继续网页。";
            }
            return false;
          }
          flight = this.takeFlight(userId, channelId, record.batch.id);
          const dispatchSignal = AbortSignal.any([combinedSignal, flight.controller.signal]);
          await this.sendBatch(record, transport, dispatchSignal, false);
          const { batch } = await this.repository.get(userId, channelId, record.batch.id);
          batches.set(batch.id, batch);
          if (!dispatchSignal.aborted && batch.summary.sent === batch.summary.total) return true;
          qqDeliveryError = dispatchSignal.aborted ? "QQ 推进已停止，已保存的剧情保留。"
            : "剧情已保存，QQ 交付未确认；已暂停后续推进。";
        } catch {
          if (combinedSignal.aborted || flight?.controller.signal.aborted) {
            await this.repository.cancelPending(userId, channelId, record.batch.id).catch(() => {});
          }
          qqDeliveryError = "剧情已保存，QQ 交付未能结算；已暂停后续推进，请查看交付记录。";
          const fresh = await this.repository.get(userId, channelId, record.batch.id).catch(() => null);
          if (fresh) batches.set(fresh.batch.id, fresh.batch);
        } finally {
          if (flight) this.releaseFlight(userId, flight);
        }
        return false;
      },
      readResult: () => ({ qqDelivery: Array.from(batches.values(), batch => this.displayBatch(batch)), ...(qqDeliveryError ? { qqDeliveryError } : {}) }),
    };
  }

  async retry(input: RetryInput): Promise<VersionedBatch> {
    const { userId, channelId, batchId } = input;
    if (advance.getCurrentWebChannelAdvanceTask(channelId, userId)) {
      throw new QqError("CONFLICT", "频道正在推进，请先停止或等待后再重发。");
    }
    const flight = this.takeFlight(userId, channelId, batchId);
    try {
      const channel = await this.getChannel(channelId, userId);
      if (!publicChannel(channel)) throw new QqError("NOT_FOUND", "频道不存在或已停用。");
      const saved = await this.repository.get(userId, channelId, batchId);
      const ticket = await this.repository.getRoute(userId);
      if (!ticket || !sameQqRoleplayRoute(saved.ticket, ticket)) throw staleRoute();
      const transport = await this.prepareTransport(ticket);
      if (advance.getCurrentWebChannelAdvanceTask(channelId, userId)) {
        throw new QqError("CONFLICT", "频道正在推进，请先停止或等待后再重发。");
      }
      const signal = AbortSignal.any([flight.controller.signal, transport.signal]);
      signal.throwIfAborted();
      const { record, started } = await this.repository.beginRetry({ ...input, allowUnknown: input.allowUnknown === true });
      if (!started) return this.displayBatch(record.batch);
      await this.sendBatch(record, transport, signal, true);
      return this.displayBatch((await this.repository.get(userId, channelId, batchId)).batch);
    } finally {
      this.releaseFlight(userId, flight);
    }
  }

  private async runLoop(loop: Loop) {
    const { userId, channelId } = loop.ticket;
    try {
      for (let index = 0; index < loop.status.total && !loop.signal.aborted; index++) {
        const operationId = randomUUID();
        const result = await advance.runWebChannelAdvanceTurn(loop.task, operationId, "qq-roleplay", async (shouldAbort, save) => {
          const delivery = await this.prepareTurn(userId, channelId, operationId, "qq", loop.signal, loop.ticket);
          if (!delivery || shouldAbort()) throw staleRoute();
          return this.generate({ channelId, userId, shouldAbort, save, generationRevision: loop.task.generationRevision, signal: delivery.signal, delivery });
        });
        loop.status.current = index + 1;
        if (result.spoken) loop.status.lastSpeaker = result.beats?.at(-1)?.speakerName ?? result.speakerName;
        if (result.cancelled || loop.signal.aborted || result.qqDeliveryError) break;
      }
    } catch {
      // 背景任务失败不回显模型响应、凭据或上游网络错误，也不自动续跑。
    } finally {
      advance.finishWebChannelAdvance({ userId, channelId, taskId: loop.task.taskId });
      if (this.loops.get(userId) === loop) this.loops.delete(userId);
    }
  }

  private async setChannel(input: Inbound, previous: QqRoleplayTicket | null, next: number | null) {
    const { userId } = input.config;
    const task = previous && advance.getCurrentWebChannelAdvanceTask(previous.channelId, userId);
    const flight = this.flights.get(userId);
    input.signal.throwIfAborted();
    await this.repository.setRoute(input.config, next);
    if (previous && previous.channelId !== next) {
      if (task) advance.stopWebChannelAdvance({ userId, channelId: previous.channelId, taskId: task.taskId });
      if (flight && flight.channelId === previous.channelId && this.flights.get(userId) === flight) flight.controller.abort();
    }
  }

  async handleInbound(input: Inbound): Promise<boolean> {
    const command = input.unsupportedMedia ? null : parseQqRoleplayCommand(input.text);
    const requestOrder = command?.kind === "advance" ? advance.reserveWebChannelAdvanceOrder() : undefined;
    const { config, signal, reply } = input;
    signal.throwIfAborted();
    const route = await this.repository.getRoute(config.userId);
    signal.throwIfAborted();
    const current = route && qqRoleplayConfigMatches(route, config) ? route : null;
    if (route && !current) throw staleRoute();
    if (input.unsupportedMedia) {
      await reply(current ? "当前频道只支持文字引导。" : "普通私聊的入站图片和语音处理尚未启用，请发送文字。");
      return true;
    }
    if (!command) {
      if (!current) return false;
      const task = advance.getCurrentWebChannelAdvanceTask(current.channelId, current.userId);
      await this.writeNote(current, input.text);
      if (task && advance.stopWebChannelAdvance({ userId: current.userId, channelId: current.channelId, taskId: task.taskId })) {
        await reply("引导已保存，当前推进已暂停；发 /R 继续。");
      }
      return true;
    }
    if (command.kind === "invalid") {
      await reply("请发送有效的频道编号，或用 /R1 到 /R50 推进指定轮数；/S 停止。");
      return true;
    }
    if (command.kind === "list" || command.kind === "enter") {
      const channels = (await this.listChannels(config.userId)).filter(publicChannel).slice(0, QQ_ROLEPLAY_CHANNEL_PAGE);
      signal.throwIfAborted();
      if (command.kind === "list") {
        const rows = channels.map(({ name }, index) => `${index + 1}. ${Array.from(name.replace(/\[CQ:/gi, "［CQ:").replace(/[\r\n\0]/g, " ")).slice(0, 55).join("")}`);
        await reply(rows.length ? `可用频道（发「进入频道 编号」进入）：\n${rows.join("\n")}` : "当前没有可用的角色频道。");
        return true;
      }
      const last = this.lastChannel.get(config.userId);
      const chosenId = current?.channelId ?? (last?.configId === config.id && last.generation === config.generation ? last.channelId : undefined);
      const chosen = command.index === undefined
        ? channels.find(channel => channel.id === chosenId) ?? channels[0]
        : channels[command.index - 1];
      if (!chosen) { await reply("请先发「频道列表」，再按编号选择可用的频道。"); return true; }
      if (current?.channelId !== chosen.id) await this.setChannel(input, current, chosen.id);
      this.lastChannel.set(config.userId, { configId: config.id, generation: config.generation, channelId: chosen.id });
      await reply("已进入频道。普通文字作为剧情引导；发 /R 持续推进、/R数字 指定轮数、/S 停止，或发「退出频道」。");
      return true;
    }
    if (!current) {
      await reply("当前未进入角色频道。请先发「频道列表」，再按编号进入。");
      return true;
    }
    const { userId, channelId } = current;
    if (command.kind === "exit") {
      await this.setChannel(input, current, null);
      this.lastChannel.set(userId, { configId: config.id, generation: config.generation, channelId });
      await reply("已退出频道，频道历史保留，普通文字将回到单人物聊天。");
      return true;
    }
    if (command.kind === "status") {
      const state = this.status(userId, channelId);
      const pending = (await this.repository.recent(userId, channelId)).some(item => sameQqRoleplayRoute(item.ticket, current) && canRetry(item.batch));
      await reply(state?.running ? `频道推进中（${state.current}/${state.total}），发 /S 停止。`
        : pending ? "频道已暂停，QQ 有未完成交付；请查看网页频道的 QQ 交付卡。" : "当前在角色频道中，发 /R 推进，或发「退出频道」。");
      return true;
    }
    if (command.kind === "stop") {
      const stopped = await this.stop(userId, channelId);
      await reply(stopped ? "已停止频道推进。已保存的剧情保留，已发出的请求不能撤回。" : "当前没有正在推进的频道任务。");
      return true;
    }
    if (command.kind !== "advance") return true;
    const pending = (await this.repository.recent(userId, channelId)).some(item => sameQqRoleplayRoute(item.ticket, current) && canRetry(item.batch));
    if (pending) { await reply("QQ 有未完成的交付，已暂停推进；请先查看网页频道的 QQ 交付卡。"); return true; }
    const latest = await this.repository.getRoute(userId);
    signal.throwIfAborted();
    if (!latest || !sameSnapshot(latest, current)) throw staleRoute();
    if (advance.getCurrentWebChannelAdvanceTask(channelId, userId) || this.flights.has(userId)) {
      await reply("频道正在推进或交付，请先停止或等待结束。");
      return true;
    }
    const task = advance.startWebChannelAdvance({ userId, channelId, taskId: `qq-${randomUUID()}:1`, generationRevision: current.channelRevision }, requestOrder);
    if (!task) { await reply("推进请求已取消，请重新发送推进指令。"); return true; }
    const loop: Loop = {
      ticket: current, task, signal: AbortSignal.any([signal, task.signal]),
      status: { channelId, running: true, current: 0, total: command.total, continuous: command.continuous, lastSpeaker: null, startedAt: new Date().toISOString() },
    };
    this.loops.set(userId, loop);
    try {
      await reply(command.continuous ? "已开始持续推进（本次最多 50 轮），发 /S 停止。" : `已开始推进 ${command.total} 轮，发 /S 停止。`);
    } catch (error) {
      advance.finishWebChannelAdvance({ userId, channelId, taskId: task.taskId });
      if (this.loops.get(userId) === loop) this.loops.delete(userId);
      throw error;
    }
    void this.runLoop(loop);
    return true;
  }
}
