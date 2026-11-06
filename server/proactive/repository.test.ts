import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { users } from "../../drizzle/schema";
import { proactiveJobs, proactivePolicies } from "../../drizzle/proactive-schema";
import { encryptSecret } from "../_core/crypto";
import { createQqRepository } from "../channels/qq/repository";
import * as db from "../db";
import { defaultSettings } from "./policy";
import { createProactiveRepository } from "./repository";
import type { ProactivePolicy, ProactiveSettings } from "./types";

const url = process.env.INK_AND_KIN_PROACTIVE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const repository = createProactiveRepository();
const qq = createQqRepository();
let database: NonNullable<Awaited<ReturnType<typeof db.getDb>>> | undefined;
let previousUrl: string | undefined;
let switched = false;
const accounts: number[] = [];
const base = new Date("2026-11-08T14:58:00.000Z");
const minute = (offset: number) => new Date(base.getTime() + offset * 60_000);

function required<T>(value: T | null | undefined, name: string): T {
  if (value == null) throw new Error("缺少隔离验收数据：" + name);
  return value;
}

function assertUrl(value: string): number {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("隔离库连接地址无效。"); }
  const port = Number(parsed.port);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    || !Number.isInteger(port) || port < 1 || port === 5434 || parsed.pathname !== "/ink_and_kin_batch7"
    || parsed.search || parsed.hash) {
    throw new Error("主动调度验收只接受本机非 5434 端口的 ink_and_kin_batch7 隔离库。");
  }
  return port;
}

function settings(overrides: Partial<ProactiveSettings> = {}): ProactiveSettings {
  return { ...defaultSettings, enabled: true, times: ["12:00"], quietHours: "00:00-00:00",
    maxPerLocalDay: 3, minIntervalMinutes: 5, ...overrides };
}

async function fixture() {
  const tag = randomUUID().replace(/-/g, "");
  const [account] = await required(database, "隔离库").insert(users)
    .values({ username: "proactive-test-" + tag, name: "合成验收账号" }).returning({ id: users.id });
  const userId = account.id;
  accounts.push(userId);
  const personaId = await db.createPersona({ userId, name: "潮汐记录员", analysisStatus: "ready" });
  return { userId, personaId, tag };
}

async function connectQq(account: Awaited<ReturnType<typeof fixture>>) {
  const { userId, personaId, tag } = account;
  const digits = 1_720_000_000_000 + parseInt(tag.slice(0, 9), 16) * 10;
  const fields = {
    personaId, botId: String(digits), targetId: String(digits + 1), apiBaseUrl: "http://127.0.0.1:9",
    secretsEnc: await encryptSecret(JSON.stringify({ apiToken: "", receiveToken: "", webhookSecret: "synthetic-" + tag })),
  };
  const saved = await qq.save(userId, null, fields);
  const config = await qq.enable(userId, saved.generation);
  return { fields, config, consent: { configId: config.id, generation: config.generation, targetId: config.targetId } };
}

async function queued(policy: ProactivePolicy, triggerKey = "followup:" + randomUUID(), expiresAt = minute(4000)) {
  return required(await repository.enqueue(policy.userId, policy.personaId, {
    policyRevision: policy.revision, kind: "followup", triggerKey, topic: "用户明确要求复习地图", dueAt: base, expiresAt,
  }), "待处理任务");
}

async function ready(policy: ProactivePolicy, expiresAt?: Date) {
  const job = await queued(policy, undefined, expiresAt);
  const claim = required(await repository.claim(job, base), "生成令牌");
  expect(await repository.saveText(claim, "地图已整理好。", base)).toBe(true);
  return claim;
}

async function status(userId: number, personaId: number, id: number) {
  return required((await repository.list(userId, personaId)).find(job => job.id === id), "任务历史");
}

suite("第 7 批主动调度：隔离 PostgreSQL 仓储", () => {
  beforeAll(async () => {
    const port = assertUrl(url!);
    previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url!;
    switched = true;
    database = required(await db.getDb(), "隔离库连接");
    const identity = await database.execute(sql`SELECT current_database() AS name, inet_server_port() AS port`);
    expect(identity.rows[0]).toMatchObject({ name: "ink_and_kin_batch7", port });
    const migrated = await database.execute(sql`
      SELECT to_regclass('public.proactive_policies') IS NOT NULL
        AND to_regclass('public.proactive_jobs') IS NOT NULL AS ready`);
    expect(migrated.rows[0]).toMatchObject({ ready: true });
  }, 30_000);

  afterEach(async () => {
    for (const userId of accounts.splice(0)) await db.deleteUserAccount(userId);
  }, 30_000);

  afterAll(async () => {
    try { await database?.$client.end(); }
    finally {
      if (switched) {
        if (previousUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousUrl;
      }
    }
  }, 30_000);

  it("默认关闭、策略版本并发只成功一次；重新配置也不重复同一定时槽", async () => {
    const { userId, personaId } = await fixture();
    const other = await fixture();
    const unready = await db.createPersona({ userId, name: "尚未就绪" });
    expect(await repository.getPolicy(userId, personaId)).toMatchObject({ enabled: false, delivery: "web", revision: 0, qqConsent: null });
    await expect(repository.getPolicy(other.userId, personaId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repository.getPolicy(userId, unready)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const saves = await Promise.allSettled([
      repository.savePolicy(userId, personaId, 0, settings(), null),
      repository.savePolicy(userId, personaId, 0, settings(), null),
    ]);
    expect(saves.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const rejection = saves.find((item): item is PromiseRejectedResult => item.status === "rejected");
    expect(rejection?.reason).toMatchObject({ code: "CONFLICT" });

    const trigger = { policyRevision: 1, kind: "scheduled" as const, triggerKey: "scheduled:2026-11-08:14:58",
      topic: "固定的定时主题", dueAt: base, expiresAt: minute(90) };
    const job = required(await repository.enqueue(userId, personaId, trigger), "定时槽");
    const claim = required(await repository.claim(job, base), "定时槽令牌");
    const next = await repository.savePolicy(userId, personaId, 1, settings({ stylePrompt: "新风格" }), null);
    expect(next.revision).toBe(2);
    expect(await repository.enqueue(userId, personaId, { ...trigger, policyRevision: next.revision, topic: "不得覆盖旧主题" })).toBeNull();
    expect(await repository.saveText(claim, "迟到的正文。", base)).toBe(false);
    expect(await status(userId, personaId, job.id)).toMatchObject({ status: "cancelled", topic: "固定的定时主题", text: null });
  }, 30_000);

  it("只允许一个生成令牌；取消、过期和中止不让迟到正文进入待发送", async () => {
    const { userId, personaId } = await fixture();
    const policy = await repository.savePolicy(userId, personaId, 0, settings(), null);
    const job = await queued(policy);
    const claims = (await Promise.all(Array.from({ length: 6 }, () => repository.claim(job, base)))).filter(claim => claim !== null);
    expect(claims).toHaveLength(1);
    const claim = claims[0];
    expect(await repository.saveText({ ...claim, token: randomUUID() }, "伪造令牌。", base)).toBe(false);
    const stop = new AbortController();
    stop.abort();
    await expect(repository.saveText(claim, "停止后不能提交。", base, stop.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(await status(userId, personaId, job.id)).toMatchObject({ status: "generating", text: null });
    expect(await repository.cancel(userId, personaId, job.id)).toBe(true);
    expect(await repository.saveText(claim, "已取消。", base)).toBe(false);

    const expiringPending = await queued(policy, undefined, minute(10));
    const expiringGenerating = await queued(policy, undefined, minute(10));
    required(await repository.claim(expiringGenerating, base), "待过期生成");
    const expiringReady = await ready(policy, minute(10));
    const expiredRows = [expiringPending.id, expiringGenerating.id, expiringReady.job.id];
    const pending = await repository.pending(minute(11));
    expect(pending.some(row => expiredRows.includes(row.id))).toBe(false);
    for (const id of expiredRows) {
      expect(await status(userId, personaId, id)).toMatchObject({ status: "expired", attemptedAt: null });
    }
    const quiet = await repository.savePolicy(userId, personaId, policy.revision, settings({ quietHours: "14:00-16:00" }), null);
    const held = await queued(quiet);
    expect(await repository.claim(held, base)).toBeNull();
    expect(await status(userId, personaId, held.id)).toMatchObject({ status: "pending", claimToken: null });
  }, 30_000);

  it("站内确认原子记账，本地日切换不绕过最小间隔，已读不改送达", async () => {
    const { userId, personaId } = await fixture();
    const policy = await repository.savePolicy(userId, personaId, 0, settings({ timeZone: "Asia/Tokyo", maxPerLocalDay: 1 }), null);
    const first = await ready(policy);
    const second = await ready(policy);
    const third = await ready(policy);
    const results = await Promise.all([repository.deliverWeb(first, base), repository.deliverWeb(first, base)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await status(userId, personaId, first.job.id)).toMatchObject({
      status: "confirmed", localDay: "2026-11-08", remoteMessageId: null, attemptedAt: base,
    });
    expect(await repository.deliverWeb(second, minute(1))).toBe(false);
    expect(await repository.deliverWeb(second, minute(3))).toBe(false); // Next local day, still inside five minutes.
    expect(await repository.deliverWeb(second, minute(5))).toBe(true);
    expect(await status(userId, personaId, second.job.id)).toMatchObject({ status: "confirmed", localDay: "2026-11-09" });
    expect(await repository.deliverWeb(third, minute(60))).toBe(false); // The new local day is already full.
    await repository.markRead(userId, personaId, first.job.id);
    expect(await status(userId, personaId, first.job.id)).toMatchObject({ status: "confirmed", readAt: expect.any(Date), remoteMessageId: null });
  }, 30_000);

  it("外层派发事务回滚仍保留持久未知；只结算一次，换策略也不会自动再发", async () => {
    const f = await fixture();
    const { userId, personaId } = f;
    const { config, consent } = await connectQq(f);
    const policy = await repository.savePolicy(userId, personaId, 0, settings({ delivery: "qq" }), consent);
    const claim = await ready(policy);
    expect(await repository.reserveDispatch(claim, base)).toBe(true);
    expect(await repository.reserveDispatch(claim, base)).toBe(false);
    const deliveryId = required(await qq.claimDelivery(config, "proactive:" + claim.job.id), "真实 QQ 占键");
    const transport = vi.fn<() => Promise<string>>(() => { throw new Error("合成派发事务回滚"); });
    await expect(qq.dispatchDelivery(config, deliveryId, transport, tx => repository.guardDispatch(tx, claim, base)))
      .rejects.toThrow("合成派发事务回滚");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await status(userId, personaId, claim.job.id)).toMatchObject({ status: "unknown", reason: "dispatch_pending", attemptedAt: base });
    const userClock = createProactiveRepository({ now: () => base });
    expect(await userClock.acknowledgeUnknown(userId, personaId, claim.job.id)).toBe(false);
    await repository.failBeforeDispatch(claim, "model_failed");
    expect(await userClock.cancel(userId, personaId, claim.job.id)).toBe(true);
    await repository.finish({ ...claim, token: randomUUID() }, { status: "failed", remoteMessageId: null, reason: "rejected_by_api" });
    expect(await status(userId, personaId, claim.job.id)).toMatchObject({
      status: "unknown", reason: "dispatch_pending", cancelRequestedAt: base,
    });
    await repository.finish(claim, { status: "unknown", remoteMessageId: null, reason: "transport_unconfirmed" });
    await repository.finish(claim, { status: "failed", remoteMessageId: null, reason: "rejected_by_api" });
    expect(await status(userId, personaId, claim.job.id)).toMatchObject({ status: "unknown", reason: "transport_unconfirmed" });

    const revised = await repository.savePolicy(userId, personaId, policy.revision, settings({ maxPerLocalDay: 1 }), null);
    const newJob = await queued(revised);
    expect(await repository.claim(newJob, minute(1500))).toBeNull();
    await repository.markRead(userId, personaId, claim.job.id);
    expect(await status(userId, personaId, claim.job.id)).toMatchObject({ unknownAcknowledgedAt: null, status: "unknown" });
    expect(await userClock.acknowledgeUnknown(userId, personaId, claim.job.id)).toBe(true);
    expect(await createProactiveRepository({ now: () => minute(60) }).acknowledgeUnknown(userId, personaId, claim.job.id)).toBe(true);
    expect(await status(userId, personaId, claim.job.id)).toMatchObject({
      unknownAcknowledgedAt: base, status: "unknown", attemptedAt: base, text: "地图已整理好。", remoteMessageId: null,
    });
    expect(await repository.claim(newJob, minute(60))).toBeNull(); // Acknowledgment does not clear today's quota.
    expect(await repository.claim(newJob, minute(1500))).not.toBeNull();
    await repository.pending(minute(5000));
    expect(await status(userId, personaId, claim.job.id)).toMatchObject({ status: "unknown" });
  }, 30_000);

  it("占位后只登记取消且拒绝启动；过期仍须等待未知恢复宽限", async () => {
    const f = await fixture();
    const { userId, personaId } = f;
    const { config, consent } = await connectQq(f);
    const policy = await repository.savePolicy(userId, personaId, 0, settings({ delivery: "qq" }), consent);
    const claim = await ready(policy, minute(1));
    expect(await repository.reserveDispatch(claim, base)).toBe(true);
    const id = required(await qq.claimDelivery(config, "proactive:" + claim.job.id), "QQ 占键");
    const now = createProactiveRepository({ now: () => base });
    expect(await now.cancel(userId, personaId, claim.job.id)).toBe(true);
    expect(await now.cancel(userId, personaId, claim.job.id)).toBe(true);
    const send = vi.fn(async () => "不得启动");
    await expect(qq.dispatchDelivery(config, id, send, tx => repository.guardDispatch(tx, claim, base)))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(send).not.toHaveBeenCalled();
    const justExpired = createProactiveRepository({ now: () => new Date(minute(1).getTime() + 1000) });
    expect(await justExpired.acknowledgeUnknown(userId, personaId, claim.job.id)).toBe(false);
    expect(await status(userId, personaId, claim.job.id)).toMatchObject({
      status: "unknown", reason: "dispatch_pending", cancelRequestedAt: base, unknownAcknowledgedAt: null,
    });
    const afterGrace = createProactiveRepository({ now: () => minute(5) });
    expect(await afterGrace.acknowledgeUnknown(userId, personaId, claim.job.id)).toBe(true);
    expect(await status(userId, personaId, claim.job.id)).toMatchObject({
      status: "unknown", reason: "dispatch_pending", attemptedAt: base, unknownAcknowledgedAt: minute(5),
    });
  }, 30_000);

  it("旧未知不被最近列表挤出，未知账号不占扫描页，游标可越过免打扰账号", async () => {
    const blockedOwner = await fixture();
    const { consent } = await connectQq(blockedOwner);
    const blockedPolicy = await repository.savePolicy(blockedOwner.userId, blockedOwner.personaId, 0,
      settings({ delivery: "qq" }), consent);
    const unresolved = await ready(blockedPolicy);
    expect(await repository.reserveDispatch(unresolved, base)).toBe(true);
    await Promise.all(Array.from({ length: 51 }, () => queued(blockedPolicy)));
    const visible = await repository.list(blockedOwner.userId, blockedOwner.personaId);
    expect(visible).toHaveLength(51);
    expect(visible[0]).toMatchObject({ id: unresolved.job.id, status: "unknown", unknownAcknowledgedAt: null });

    const quietOwner = await fixture();
    const quietPolicy = await repository.savePolicy(quietOwner.userId, quietOwner.personaId, 0,
      settings({ quietHours: "14:00-16:00" }), null);
    const quiet = [await queued(quietPolicy), await queued(quietPolicy), await queued(quietPolicy)];
    const freeOwner = await fixture();
    const freePolicy = await repository.savePolicy(freeOwner.userId, freeOwner.personaId, 0, settings(), null);
    const free = await queued(freePolicy);

    const first = await repository.pending(base, 2, unresolved.job.id - 1);
    expect(first.map(job => job.id)).toEqual(quiet.slice(0, 2).map(job => job.id));
    expect(await repository.claim(first[0], base)).toBeNull();
    const second = await repository.pending(base, 2, first[1].id);
    expect(second.map(job => job.id)).toEqual([quiet[2].id, free.id]);
    expect(await repository.claim(second[1], base)).not.toBeNull();
  }, 30_000);

  it("QQ 授权只对应绑定角色，明确失败仍计入频率，改绑后不能派发旧授权", async () => {
    const f = await fixture();
    const { userId, personaId } = f;
    const otherPersona = await db.createPersona({ userId, name: "另一个人物", analysisStatus: "ready" });
    const { config, consent, fields } = await connectQq(f);
    const options = settings({ delivery: "qq", maxPerLocalDay: 1 });
    await expect(repository.savePolicy(userId, otherPersona, 0, options, consent)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const policy = await repository.savePolicy(userId, personaId, 0, options, consent);
    const claim = await ready(policy);
    const blocked = await ready(policy);
    expect(await repository.reserveDispatch(claim, base)).toBe(true);
    const firstId = required(await qq.claimDelivery(config, "proactive:" + claim.job.id), "QQ 占键");
    const send = vi.fn(async () => ({ status: "failed" as const, remoteMessageId: null, reason: "rejected_by_api" }));
    const launched = await qq.dispatchDelivery(config, firstId, send, tx => repository.guardDispatch(tx, claim, base));
    await repository.finish(claim, await launched.result);
    expect(await status(userId, personaId, claim.job.id)).toMatchObject({ status: "failed", attemptedAt: base });
    expect(await repository.reserveDispatch(blocked, minute(60))).toBe(false);
    expect(await repository.reserveDispatch(blocked, minute(1500))).toBe(true);

    const rebound = await qq.save(userId, config.generation, { ...fields, targetId: String(Number(config.targetId) + 1) });
    await qq.enable(userId, rebound.generation);
    const refused = vi.fn(async () => "不得启动");
    await expect(db.withTransaction(async tx => {
      await repository.guardDispatch(tx, blocked, minute(1500));
      return refused();
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(refused).not.toHaveBeenCalled();
    expect(await status(userId, personaId, blocked.job.id)).toMatchObject({ status: "unknown", reason: "dispatch_pending" });
    const stopped = await repository.savePolicy(userId, personaId, policy.revision, { ...options, enabled: false }, null);
    expect(stopped).toMatchObject({ enabled: false, delivery: "qq", qqConsent: null });
    expect(await status(userId, personaId, blocked.job.id)).toMatchObject({ status: "unknown" });
    expect(await createProactiveRepository({ now: () => minute(5000) }).acknowledgeUnknown(userId, personaId, blocked.job.id)).toBe(true);
    expect(await status(userId, personaId, blocked.job.id)).toMatchObject({
      status: "unknown", unknownAcknowledgedAt: minute(5000), attemptedAt: minute(1500), reason: "dispatch_pending",
    });
  }, 30_000);

  it("派发以锁后的时间为准，读库期间进入免打扰也不能启动请求", async () => {
    const f = await fixture();
    const { userId, personaId } = f;
    const web = await repository.savePolicy(userId, personaId, 0, settings(), null);
    const expired = await ready(web, minute(1));
    const later = createProactiveRepository({ now: () => minute(2) });
    expect(await later.deliverWeb(expired, base)).toBe(false);
    expect(await status(userId, personaId, expired.job.id)).toMatchObject({ status: "expired", attemptedAt: null });

    const { config, consent } = await connectQq(f);
    const quiet = await repository.savePolicy(userId, personaId, web.revision,
      settings({ delivery: "qq", quietHours: "15:00-16:00" }), consent);
    const claim = await ready(quiet, minute(90));
    expect(await repository.reserveDispatch(claim, base)).toBe(true);
    const id = required(await qq.claimDelivery(config, "proactive:" + claim.job.id), "QQ 占键");
    const instants = [base, minute(2)];
    const crossing = createProactiveRepository({ now: () => instants.shift() ?? minute(2) });
    const send = vi.fn(async () => "不得启动");
    await expect(qq.dispatchDelivery(config, id, send, tx => crossing.guardDispatch(tx, claim, base)))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(send).not.toHaveBeenCalled();
    expect(await status(userId, personaId, claim.job.id)).toMatchObject({ status: "unknown", reason: "dispatch_pending", attemptedAt: base });
  }, 30_000);

  it("删除人物与账号会分别级联清除策略和任务", async () => {
    const { userId, personaId } = await fixture();
    const one = await repository.savePolicy(userId, personaId, 0, settings(), null);
    await queued(one);
    await db.deletePersona(personaId, userId);
    expect(await required(database, "隔离库").select().from(proactiveJobs).where(eq(proactiveJobs.personaId, personaId))).toEqual([]);
    expect(await required(database, "隔离库").select().from(proactivePolicies).where(eq(proactivePolicies.personaId, personaId))).toEqual([]);

    const nextPersona = await db.createPersona({ userId, name: "合成人物二", analysisStatus: "ready" });
    const two = await repository.savePolicy(userId, nextPersona, 0, settings(), null);
    await queued(two);
    await db.deleteUserAccount(userId);
    accounts.splice(accounts.indexOf(userId), 1);
    expect(await required(database, "隔离库").select().from(proactiveJobs).where(eq(proactiveJobs.userId, userId))).toEqual([]);
    expect(await required(database, "隔离库").select().from(proactivePolicies).where(eq(proactivePolicies.userId, userId))).toEqual([]);
  }, 30_000);
});
