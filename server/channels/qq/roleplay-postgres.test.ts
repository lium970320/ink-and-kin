import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { roleplayMessages, users } from "../../../drizzle/schema";
import { qqRoleplayAttempts, qqRoleplayBatches, qqRoleplayParts, qqRoleplayRoutes } from "../../../drizzle/qq-roleplay-schema";
import { encryptSecret } from "../../_core/crypto";
import * as db from "../../db";
import { createQqRepository } from "./repository";
import { createQqRoleplayRepository } from "./roleplay-repository";
import { QqRoleplayService } from "./roleplay-service";
import type { DeliveryResult } from "./core";
import type { QqRoleplayRepository, QqRoleplayTicket } from "./roleplay-types";

const testUrl = process.env.INK_AND_KIN_QQ_ROLEPLAY_TEST_DATABASE_URL;
const databaseSuite = testUrl ? describe : describe.skip;
const repository = createQqRoleplayRepository();
const qq = createQqRepository();
const fixedTexts = [" 甲段：潮水退去。\n", "乙段：仍有一盏灯。"];
const ownerIds: number[] = [];
let connection: NonNullable<Awaited<ReturnType<typeof db.getDb>>> | undefined;
let previousUrl: string | undefined;

function isolatedUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("QQ 频道验收库连接地址格式无效。"); }
  const port = Number(url.port);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !Number.isInteger(port) || port < 1 || port === 5434
    || url.pathname !== "/ink_and_kin_batch6b" || url.search || url.hash) {
    throw new Error("QQ 频道验收只接受明确非 5434 端口的本机 ink_and_kin_batch6b 隔离库。");
  }
  return port;
}

function database() {
  if (!connection) throw new Error("未初始化 QQ 频道验收隔离库。");
  return connection;
}

function present<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error("缺少验收数据：" + label);
  return value;
}

function confirmed(id: string): DeliveryResult {
  return { status: "confirmed", remoteMessageId: id, reason: "confirmed_by_api" };
}

const unknown: DeliveryResult = { status: "unknown", remoteMessageId: null, reason: "transport_unconfirmed" };
const failed: DeliveryResult = { status: "failed", remoteMessageId: null, reason: "rejected_by_api" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function fixture() {
  const tag = randomUUID().replace(/-/g, "");
  const [owner] = await database().insert(users).values({ username: "qq-6b-" + tag, name: "合成频道验收账号" })
    .returning({ id: users.id });
  ownerIds.push(owner.id);
  const userId = owner.id;
  const personaId = await db.createPersona({ userId, name: "纸鸥", analysisStatus: "ready" });
  const second = await db.createPersona({ userId, name: "铜灯", analysisStatus: "ready" });
  const channelId = await db.createRoleplayChannel({ userId, name: "灯塔档案" }, [personaId, second]);
  const idBase = 1_700_000_000_000 + parseInt(tag.slice(0, 9), 16) * 10;
  const fields = {
    apiBaseUrl: "http://127.0.0.1:9", botId: String(idBase), targetId: String(idBase + 1), personaId,
    secretsEnc: await encryptSecret(JSON.stringify({ apiToken: "", receiveToken: "", webhookSecret: "fixture-only-" + tag })),
  };
  const saved = await qq.save(userId, null, fields);
  const config = await qq.enable(userId, saved.generation);
  const ticket = present(await repository.setRoute(config, channelId), "活动路由");
  return { userId, personaId, second, channelId, config, ticket, fields };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function beatMessage(f: Fixture, tx: db.DbTransaction, ticket: QqRoleplayTicket, excluded = false) {
  return db.createRoleplayMessage({
    userId: f.userId, channelId: f.channelId, personaId: f.personaId, role: "persona", speakerName: "纸鸥",
    content: "【潮水退去。】\n灯还亮着。", mode: "channel", ...(excluded ? { contextOverride: "excluded" as const } : {}),
  }, ticket.channelRevision, tx);
}

async function commitBeat(f: Fixture, excluded = false) {
  const operationId = randomUUID();
  return db.withRoleplayBeatTransaction(async tx => {
    await repository.validateRoute(tx, f.ticket);
    const message = await beatMessage(f, tx, f.ticket, excluded);
    const record = await repository.createBeat(tx, f.ticket, {
      messageId: message.id, operationId, source: "web", beatIndex: 2, texts: [...fixedTexts],
    });
    return { record, operationId, messageId: message.id };
  });
}

databaseSuite("QQ 角色频道：隔离 PostgreSQL 仓储回归", () => {
  beforeAll(async () => {
    const port = isolatedUrl(testUrl!);
    previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testUrl!;
    connection = present(await db.getDb(), "隔离数据库");
    const result = await connection.execute(sql`SELECT current_database() AS name, inet_server_port() AS port`);
    expect(result.rows[0]).toMatchObject({ name: "ink_and_kin_batch6b", port });
    const migrated = await connection.execute(sql`
      SELECT to_regclass('public.qq_roleplay_routes') IS NOT NULL
        AND to_regclass('public.qq_roleplay_batches') IS NOT NULL
        AND to_regclass('public.qq_roleplay_parts') IS NOT NULL
        AND to_regclass('public.qq_roleplay_attempts') IS NOT NULL AS ready`);
    expect(migrated.rows[0]).toMatchObject({ ready: true });
  }, 30_000);

  afterEach(async () => {
    for (const userId of ownerIds.splice(0)) await db.deleteUserAccount(userId);
  }, 30_000);

  afterAll(async () => {
    try { await connection?.$client.end(); }
    finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  }, 30_000);

  it("活动路由与批次按账号和频道隔离，删除频道清理投递历史，删除账号再清理路由", async () => {
    const a = await fixture();
    const b = await fixture();
    const { record } = await commitBeat(a);
    const partId = record.batch.parts[0].id;
    const attemptId = present(await repository.reserveAttempt(a.ticket, record.batch.id, partId, record.activeOperationId), "级联尝试");

    await expect(repository.setRoute(b.config, a.channelId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repository.setRoute({ ...a.config, userId: b.userId }, a.channelId)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await repository.getRoute(a.userId)).toEqual(a.ticket);
    expect(await repository.getRoute(b.userId)).toEqual(b.ticket);
    await expect(repository.get(b.userId, a.channelId, record.batch.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repository.get(a.userId, b.channelId, record.batch.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repository.recent(b.userId, a.channelId)).toEqual([]);

    await db.deleteRoleplayChannel(a.channelId, a.userId);
    expect(await database().select().from(qqRoleplayRoutes).where(eq(qqRoleplayRoutes.userId, a.userId)))
      .toMatchObject([{ channelId: null, routeRevision: a.ticket.routeRevision }]);
    expect(await database().select().from(qqRoleplayBatches).where(eq(qqRoleplayBatches.id, record.batch.id))).toEqual([]);
    expect(await database().select().from(qqRoleplayParts).where(eq(qqRoleplayParts.id, partId))).toEqual([]);
    expect(await database().select().from(qqRoleplayAttempts).where(eq(qqRoleplayAttempts.id, attemptId))).toEqual([]);
    await db.deleteUserAccount(a.userId);
    ownerIds.splice(ownerIds.indexOf(a.userId), 1);
    expect(await database().select().from(qqRoleplayRoutes).where(eq(qqRoleplayRoutes.userId, a.userId))).toEqual([]);
    expect(await repository.getRoute(b.userId)).toEqual(b.ticket);
  }, 30_000);

  it("删除已进入的频道仍保留路由版本，重新进入不会复用旧版本", async () => {
    const f = await fixture();
    expect(f.ticket.routeRevision).toBeGreaterThan(0);
    await db.deleteRoleplayChannel(f.channelId, f.userId);
    expect(await repository.getRoute(f.userId)).toBeNull();
    const [inactive] = await database().select().from(qqRoleplayRoutes).where(eq(qqRoleplayRoutes.userId, f.userId));
    expect(inactive).toMatchObject({ channelId: null, routeRevision: f.ticket.routeRevision });
    const replacement = await db.createRoleplayChannel({ userId: f.userId, name: "另一座灯塔" }, [f.personaId, f.second]);
    const entered = present(await repository.setRoute(f.config, replacement), "替代频道路由");
    expect(entered.routeRevision).toBe(f.ticket.routeRevision + 1);
    expect(entered.channelId).toBe(replacement);
  }, 30_000);

  it("角色消息、批次和分段一起回滚，成功提交保留固定原文和顺序", async () => {
    const f = await fixture();
    let rolledBackMessage = 0;
    let rolledBackBatch = "";
    await expect(db.withRoleplayBeatTransaction(async tx => {
      await repository.validateRoute(tx, f.ticket);
      const message = await beatMessage(f, tx, f.ticket);
      const { batch } = await repository.createBeat(tx, f.ticket, {
        operationId: randomUUID(), messageId: message.id, source: "qq", beatIndex: 0, texts: [...fixedTexts],
      });
      rolledBackMessage = message.id;
      rolledBackBatch = batch.id;
      throw new Error("合成事务末步失败");
    })).rejects.toThrow("合成事务末步失败");
    expect(rolledBackMessage).toBeGreaterThan(0);
    expect(rolledBackBatch).toHaveLength(36);
    expect(await db.getRoleplayChannelMessages(f.channelId, f.userId)).toEqual([]);
    expect(await repository.recent(f.userId, f.channelId)).toEqual([]);
    expect(await database().select().from(qqRoleplayParts).where(eq(qqRoleplayParts.batchId, rolledBackBatch))).toEqual([]);

    const { record, messageId } = await commitBeat(f);
    const saved = await repository.get(f.userId, f.channelId, record.batch.id);
    expect(saved.batch.parts.map(part => [part.messageId, part.beatIndex, part.partIndex, part.text])).toEqual([
      [messageId, 2, 0, fixedTexts[0]], [messageId, 2, 1, fixedTexts[1]],
    ]);
    expect((await db.getRoleplayChannelMessages(f.channelId, f.userId)).map(message => message.id)).toEqual([messageId]);
  }, 30_000);

  it("首段未知阻止后段；重放不再派发，失败保留旧未知，确认保留重复风险", async () => {
    const f = await fixture();
    const { record, operationId } = await commitBeat(f);
    const batchId = record.batch.id;
    const [head, tail] = record.batch.parts;
    const get = () => repository.get(f.userId, f.channelId, batchId);
    const reserve = (partId: string, operation: string) => repository.reserveAttempt(f.ticket, batchId, partId, operation);
    const start = vi.fn(async (result: DeliveryResult) => result);
    const dispatch = (partId: string, attemptId: string, result: DeliveryResult) =>
      repository.dispatchAttempt(f.ticket, batchId, partId, attemptId, () => start(result));
    const settle = async (partId: string, attemptId: string, result: DeliveryResult) => {
      const pending = await dispatch(partId, attemptId, result);
      await repository.finishAttempt(f.userId, attemptId, await pending.result);
    };

    const first = present(await reserve(head.id, operationId), "首段占键");
    await settle(head.id, first, unknown);
    expect(await reserve(tail.id, operationId)).toBeNull();
    const beforeRetry = await get();
    expect(beforeRetry.batch.parts.map(part => part.status)).toEqual(["unknown", "pending"]);
    const base = { userId: f.userId, channelId: f.channelId, batchId, expectedVersion: beforeRetry.batch.version };
    await expect(repository.beginRetry({ ...base, operationId: randomUUID(), allowUnknown: false }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(start).toHaveBeenCalledTimes(1);

    const retry = { ...base, operationId: randomUUID(), allowUnknown: true };
    expect((await repository.beginRetry(retry)).started).toBe(true);
    expect(await reserve(tail.id, retry.operationId)).toBeNull();
    const second = present(await reserve(head.id, retry.operationId), "重试占键");
    await settle(head.id, second, failed);
    const afterFailure = await get();
    expect(afterFailure.batch.parts[0]).toMatchObject({ status: "unknown", duplicateRisk: true, attempts: 2 });
    expect(afterFailure.batch.parts[1].status).toBe("pending");
    expect((await repository.beginRetry(retry)).started).toBe(false);
    expect(await createQqRoleplayRepository().reserveAttempt(f.ticket, batchId, head.id, retry.operationId)).toBeNull();
    await expect(dispatch(head.id, second, failed)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(repository.beginRetry({ ...retry, allowUnknown: false })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(start).toHaveBeenCalledTimes(2);

    const next = { ...retry, operationId: randomUUID(), expectedVersion: afterFailure.batch.version };
    expect((await repository.beginRetry(next)).started).toBe(true);
    const third = present(await reserve(head.id, next.operationId), "确认首段占键");
    await settle(head.id, third, confirmed("7001"));
    const last = present(await reserve(tail.id, next.operationId), "确认后段占键");
    await settle(tail.id, last, confirmed("7002"));
    const done = await get();
    expect(done.batch.parts).toMatchObject([
      { status: "sent", duplicateRisk: true, attempts: 3, qqMessageId: "7001" },
      { status: "sent", attempts: 1, qqMessageId: "7002" },
    ]);
    expect(start).toHaveBeenCalledTimes(4);
    const history = await database().select({ status: qqRoleplayAttempts.status })
      .from(qqRoleplayAttempts).where(eq(qqRoleplayAttempts.partId, head.id));
    expect(history.map(attempt => attempt.status).sort()).toEqual(["confirmed", "failed", "unknown"]);
  }, 30_000);

  it.each(["退出路由", "配置版本", "单独排除消息", "删除原消息"] as const)(
    "%s 变化后拒绝已占键的迟到派发", async change => {
      const f = await fixture();
      const { record, messageId } = await commitBeat(f);
      const partId = record.batch.parts[0].id;
      const attemptId = present(await repository.reserveAttempt(f.ticket, record.batch.id, partId, record.activeOperationId), "待派发占键");
      expect((await repository.get(f.userId, f.channelId, record.batch.id)).batch.retryable).toBe(true);

      if (change === "退出路由") {
        await expect(repository.setRoute(f.config, null)).resolves.toBeNull();
        expect(await repository.getRoute(f.userId)).toBeNull();
        const reentered = present(await repository.setRoute(f.config, f.channelId), "重新进入原频道");
        expect(reentered.routeRevision).toBeGreaterThan(f.ticket.routeRevision);
      } else if (change === "配置版本") {
        const saved = await qq.save(f.userId, f.config.generation, f.fields);
        expect((await qq.enable(f.userId, saved.generation)).enabled).toBe(true);
        expect(await repository.getRoute(f.userId)).toBeNull();
      } else if (change === "单独排除消息") {
        // Deliberately keep the revision unchanged to verify the independent source-message guard.
        await database().update(roleplayMessages).set({ contextOverride: "excluded" }).where(and(
          eq(roleplayMessages.userId, f.userId), eq(roleplayMessages.channelId, f.channelId), eq(roleplayMessages.id, messageId),
        ));
        expect(await repository.getRoute(f.userId)).toEqual(f.ticket);
      } else {
        expect(await db.deleteRoleplayMessages(f.channelId, f.userId, [messageId])).toMatchObject({ deletedMessages: 1 });
        expect(await db.getRoleplayChannelMessages(f.channelId, f.userId)).toEqual([]);
      }

      const send = vi.fn(async () => confirmed("8001"));
      await expect(repository.dispatchAttempt(f.ticket, record.batch.id, partId, attemptId, send))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(send).not.toHaveBeenCalled();
      const history = await repository.get(f.userId, f.channelId, record.batch.id);
      expect(history.batch.retryable).toBe(false);
      expect(history.batch.parts[0]).toMatchObject({ status: "unknown", text: fixedTexts[0] });
      expect(history.batch.parts[1]).toMatchObject({ status: "pending", text: fixedTexts[1] });
      const [recent] = await repository.recent(f.userId, f.channelId);
      expect(recent.batch).toMatchObject({ id: history.batch.id, retryable: false, summary: { unknown: 1, pending: 1 } });
      await expect(repository.beginRetry({
        userId: f.userId, channelId: f.channelId, batchId: record.batch.id,
        operationId: randomUUID(), expectedVersion: history.batch.version, allowUnknown: true,
      })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }, 30_000,
  );

  it("新用户引导使旧尝试不能派发；确认风险后可显式续用原文，重放不会续签", async () => {
    const f = await fixture();
    const { record } = await commitBeat(f);
    const batchId = record.batch.id;
    const [head, tail] = record.batch.parts;
    const oldAttempt = present(await repository.reserveAttempt(f.ticket, batchId, head.id, record.activeOperationId), "旧尝试");
    const postNote = (content: string) => db.createRoleplayMessage({
      userId: f.userId, channelId: f.channelId, role: "user", speakerName: "用户",
      content, mode: "channel", turnKind: "user_note",
    });
    await postNote("先停下，确认地图。");
    const current = present(await repository.getRoute(f.userId), "用户引导后的频道修订");
    expect(current.channelRevision).toBeGreaterThan(f.ticket.channelRevision);
    expect(current.routeRevision).toBe(f.ticket.routeRevision);
    // More recent, closed batches must not crowd the unresolved older revision out of the list.
    await db.withRoleplayBeatTransaction(async tx => {
      await repository.validateRoute(tx, current);
      for (let index = 0; index < 20; index++) {
        const excluded = await beatMessage(f, tx, current, true);
        await repository.createBeat(tx, current, {
          operationId: randomUUID(), messageId: excluded.id, source: "web", beatIndex: index, texts: ["排除的合成段"],
        });
      }
    });
    const history = await repository.recent(f.userId, f.channelId);
    expect(history).toHaveLength(21);
    expect(history.find(({ batch }) => batch.id === batchId)?.batch)
      .toMatchObject({ retryable: true, summary: { unknown: 1 } });
    const send = vi.fn(async () => confirmed("8101"));
    await expect(repository.dispatchAttempt(f.ticket, batchId, head.id, oldAttempt, send))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(send).not.toHaveBeenCalled();
    const stale = await repository.get(f.userId, f.channelId, batchId);
    const retry = {
      userId: f.userId, channelId: f.channelId, batchId,
      operationId: randomUUID(), expectedVersion: stale.batch.version, allowUnknown: true,
    };
    await expect(repository.beginRetry({ ...retry, allowUnknown: false }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const renewal = await repository.beginRetry(retry);
    expect(renewal.started).toBe(true);
    expect(renewal.record.ticket).toEqual(current);
    expect(renewal.record.batch.parts.map(part => part.text)).toEqual(fixedTexts);
    expect(await repository.reserveAttempt(current, batchId, tail.id, retry.operationId)).toBeNull();
    const renewedAttempt = present(await repository.reserveAttempt(current, batchId, head.id, retry.operationId), "续签尝试");
    const launched = await repository.dispatchAttempt(current, batchId, head.id, renewedAttempt, send);
    await repository.finishAttempt(f.userId, renewedAttempt, await launched.result);
    expect(send).toHaveBeenCalledTimes(1);

    await postNote("地图已经摊开。");
    const newer = present(await repository.getRoute(f.userId), "第二次引导后的频道修订");
    expect(newer.channelRevision).toBeGreaterThan(current.channelRevision);
    const replay = await repository.beginRetry(retry);
    expect(replay.started).toBe(false);
    expect(replay.record.ticket.channelRevision).toBe(current.channelRevision);
    await expect(repository.reserveAttempt(current, batchId, tail.id, retry.operationId))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [persisted] = await database().select({
      original: qqRoleplayBatches.originalChannelRevision, current: qqRoleplayBatches.channelRevision,
    }).from(qqRoleplayBatches).where(eq(qqRoleplayBatches.id, batchId));
    expect(persisted).toEqual({ original: f.ticket.channelRevision, current: current.channelRevision });
    expect((await repository.get(f.userId, f.channelId, batchId)).batch.parts[0])
      .toMatchObject({ status: "sent", duplicateRisk: true, attempts: 2 });
  }, 30_000);

  it("已排除的角色消息可保存原文历史，但不能占键或派发", async () => {
    const f = await fixture();
    const { record } = await commitBeat(f, true);
    expect(record.batch.retryable).toBe(false);
    expect(record.batch.parts.map(part => [part.status, part.text])).toEqual(fixedTexts.map(text => ["cancelled", text]));
    await expect(repository.reserveAttempt(f.ticket, record.batch.id, record.batch.parts[0].id, record.activeOperationId))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.getRoleplayChannelMessages(f.channelId, f.userId)).toHaveLength(1);
  }, 30_000);

  it("停止发生在持久占键与网络启动之间时不发送，已保存剧情仍可见", async () => {
    const f = await fixture();
    const entered = deferred<string>();
    const release = deferred<void>();
    const gated: QqRoleplayRepository = {
      ...repository,
      async reserveAttempt(...args) {
        const id = present(await repository.reserveAttempt(...args), "停止前占键");
        entered.resolve(id);
        await release.promise;
        return id;
      },
    };
    const send = vi.fn(async () => confirmed("9001"));
    const signal = new AbortController().signal;
    const service = new QqRoleplayService({ repository: gated, prepare: async () => ({ config: f.config, signal, send }) });
    const hooks = present(await service.prepareTurn(f.userId, f.channelId, randomUUID(), "web", signal), "投递钩子");
    const beat = await db.withRoleplayBeatTransaction(async tx => {
      await hooks.beforeSave(tx);
      const message = await beatMessage(f, tx, f.ticket);
      const saved = {
        messageId: message.id, personaId: f.personaId, speakerName: "纸鸥",
        replyText: "【望向潮水。】\n灯还亮着。", innerThought: "不发送。", emotionalState: "warm" as const,
      };
      await hooks.savedBeat(tx, saved, 0);
      return saved;
    });
    const after = hooks.afterBeat(beat);
    let attemptId: string;
    try {
      attemptId = await Promise.race([entered.promise, after.then(() => { throw new Error("回合未进入已占键状态。"); })]);
      expect(await service.stop(f.userId, f.channelId)).toBe(true);
      expect(send).not.toHaveBeenCalled();
    } finally {
      release.resolve(undefined);
      await after;
    }
    expect(send).not.toHaveBeenCalled();
    const [attempt] = await database().select().from(qqRoleplayAttempts).where(eq(qqRoleplayAttempts.id, attemptId));
    expect(attempt).toMatchObject({ dispatchedAt: null, reason: "cancelled_before_dispatch" });
    const [stored] = await repository.recent(f.userId, f.channelId);
    expect(stored.batch.parts.every(part => part.status === "cancelled")).toBe(true);
    expect((await db.getRoleplayChannelMessages(f.channelId, f.userId)).map(message => message.id)).toEqual([beat.messageId]);
  }, 30_000);
});
