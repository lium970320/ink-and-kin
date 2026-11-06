import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { channelBindings, personas } from "../../drizzle/schema";
import { proactiveJobs as jobs, proactivePolicies as policies } from "../../drizzle/proactive-schema";
import { qqChannelConfigs } from "../../drizzle/qq-channel-schema";
import { getDb, lockQqChannelConfig, type DbTransaction } from "../db";
import { defaultSettings, eligibleAttempt, isQuiet, localClock, validateSettings } from "./policy";
import type {
  ProactiveClaim, ProactiveEnqueue, ProactiveJob, ProactivePolicy, ProactiveQqConsent,
  ProactiveRepository, ProactiveSettings, ProactiveStatus,
} from "./types";

type PolicyRow = typeof policies.$inferSelect;
type JobRow = typeof jobs.$inferSelect;
type Scope = { userId: number; personaId: number };
type JobIdentity = Scope & { id: number };
type JobPatch = Partial<Omit<typeof jobs.$inferInsert, "id" | "userId" | "personaId" | "policyRevision" | "kind" | "triggerKey" | "topic" | "dueAt" | "expiresAt" | "createdAt">>;

const OPEN: ProactiveStatus[] = ["pending", "generating", "ready"];
const WORKING: ProactiveStatus[] = ["generating", "ready"];
const DAY_MS = 86_400_000;
const DISPATCH_PENDING = "dispatch_pending";
const DISPATCH_STARTED = "dispatch_started";
// Job expiry alone is not proof that the last transport request has returned.
const UNKNOWN_RECOVERY_GRACE_MS = 5 * 60_000;
const STALE = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "主动任务已停用、超时或授权已变更。" });
const NOT_FOUND = () => new TRPCError({ code: "NOT_FOUND", message: "角色不存在或尚未就绪。" });
const CONFLICT = () => new TRPCError({ code: "CONFLICT", message: "主动任务设置已更新，请刷新后保存。" });

const policyScope = ({ userId, personaId }: Scope) =>
  and(eq(policies.userId, userId), eq(policies.personaId, personaId));
const jobScope = ({ userId, personaId }: Scope) =>
  and(eq(jobs.userId, userId), eq(jobs.personaId, personaId));
const jobIdentity = (job: JobIdentity) => and(jobScope(job), eq(jobs.id, job.id));

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库暂不可用。" });
  return db;
}

function policyDto(row: PolicyRow): ProactivePolicy {
  const { userId, personaId, enabled, delivery, times, stylePrompt, timeZone, quietHours,
    maxPerLocalDay, minIntervalMinutes, ambientEnabled, revision, qqConfigId, qqGeneration, qqTargetId } = row;
  const qqConsent = qqConfigId !== null && qqGeneration !== null && qqTargetId !== null
    ? { configId: qqConfigId, generation: qqGeneration, targetId: qqTargetId }
    : null;
  return { userId, personaId, enabled, delivery, times, stylePrompt, timeZone, quietHours,
    maxPerLocalDay, minIntervalMinutes, ambientEnabled, revision, qqConsent };
}

function jobDto(row: JobRow): ProactiveJob {
  const { settledAt: _, ...job } = row;
  return job;
}

/** Every writing path starts with the same QQ/account lock, including web jobs and policy creation. */
async function lockOwner(tx: DbTransaction, scope: Scope, strict = true) {
  await lockQqChannelConfig(tx, scope.userId);
  const [persona] = await tx.select({ id: personas.id }).from(personas).where(and(
    eq(personas.id, scope.personaId), eq(personas.userId, scope.userId), eq(personas.analysisStatus, "ready"),
  )).limit(1).for("share");
  if (!persona && strict) throw NOT_FOUND();
  return Boolean(persona);
}

async function lockPolicy(tx: DbTransaction, scope: Scope) {
  const [row] = await tx.select().from(policies).where(policyScope(scope)).limit(1).for("update");
  return row ? policyDto(row) : null;
}

async function lockJob(tx: DbTransaction, identity: JobIdentity) {
  const [job] = await tx.select().from(jobs).where(jobIdentity(identity)).limit(1).for("update");
  return job ?? null;
}

async function lockClaim(tx: DbTransaction, identity: JobIdentity) {
  if (!await lockOwner(tx, identity, false)) return null;
  const policy = await lockPolicy(tx, identity);
  const job = await lockJob(tx, identity);
  return job ? { policy, job } : null;
}

async function writeJob(tx: DbTransaction, job: JobRow, values: JobPatch) {
  const [row] = await tx.update(jobs).set(values).where(and(
    jobIdentity(job), eq(jobs.status, job.status),
    job.claimToken === null ? isNull(jobs.claimToken) : eq(jobs.claimToken, job.claimToken),
  )).returning();
  return row ?? null;
}

async function validQqConsent(tx: DbTransaction, scope: Scope, consent: ProactiveQqConsent | null) {
  if (!consent) return false;
  const [binding] = await tx.select({ id: qqChannelConfigs.id }).from(qqChannelConfigs)
    .innerJoin(channelBindings, and(
      eq(channelBindings.userId, qqChannelConfigs.userId), eq(channelBindings.personaId, scope.personaId),
      eq(channelBindings.channel, "qq"), eq(channelBindings.targetId, `private:${consent.targetId}`),
      eq(channelBindings.isActive, true),
    )).where(and(
      eq(qqChannelConfigs.id, consent.configId), eq(qqChannelConfigs.userId, scope.userId),
      eq(qqChannelConfigs.personaId, scope.personaId), eq(qqChannelConfigs.generation, consent.generation),
      eq(qqChannelConfigs.targetId, consent.targetId), eq(qqChannelConfigs.enabled, true),
    )).limit(1);
  return Boolean(binding);
}

function validPolicy(policy: ProactivePolicy | null, job: Pick<ProactiveJob, "policyRevision" | "kind">): policy is ProactivePolicy {
  return Boolean(policy?.enabled && policy.revision === job.policyRevision && (job.kind !== "ambient" || policy.ambientEnabled));
}

function validDelivery(tx: DbTransaction, policy: ProactivePolicy) {
  return policy.delivery === "web" ? Promise.resolve(true) : validQqConsent(tx, policy, policy.qqConsent);
}

async function canAttempt(tx: DbTransaction, policy: ProactivePolicy, now: Date, excludingJobId?: number) {
  if (isQuiet(now, policy)) return false;
  const other = excludingJobId === undefined ? undefined : ne(jobs.id, excludingJobId);
  const [unresolved] = await tx.select({ id: jobs.id }).from(jobs)
    .where(and(jobScope(policy), eq(jobs.status, "unknown"), isNull(jobs.unknownAcknowledgedAt), other)).limit(1);
  if (unresolved) return false;
  // Recompute the calendar day from the instant in the current policy zone.
  // Two days cover any current local day (including DST) and the maximum 24h interval.
  const history = await tx.select({ attemptedAt: jobs.attemptedAt }).from(jobs)
    .where(and(jobScope(policy), gte(jobs.attemptedAt, new Date(now.getTime() - 2 * DAY_MS)), other))
    .orderBy(desc(jobs.attemptedAt));
  const day = localClock(now, policy.timeZone).day;
  const countToday = history.reduce((count, row) => count + Number(
    row.attemptedAt !== null && localClock(row.attemptedAt, policy.timeZone).day === day,
  ), 0);
  return eligibleAttempt(now, policy, { countToday, lastAttemptedAt: history[0]?.attemptedAt ?? null });
}

function sameClaim(job: JobRow, claim: ProactiveClaim) {
  return job.claimToken === claim.token && job.policyRevision === claim.job.policyRevision;
}

function expired(job: JobRow, now: Date) {
  return job.expiresAt.getTime() <= now.getTime();
}

function isDue(job: JobRow, now: Date) {
  return job.dueAt.getTime() <= now.getTime();
}

async function expire(tx: DbTransaction, job: JobRow, now: Date) {
  if (OPEN.includes(job.status) && !job.attemptedAt) {
    await writeJob(tx, job, { status: "expired", reason: "generation_expired", updatedAt: now });
  }
}

function legalText(value: string, limit: number) {
  const points = Array.from(value);
  return points.length <= limit && !points.some(point => {
    const code = point.charCodeAt(0);
    return code === 0 || (point.length === 1 && code >= 0xd800 && code <= 0xdfff);
  });
}

function checkEnqueue(input: ProactiveEnqueue) {
  if (!["scheduled", "followup", "ambient"].includes(input.kind) || !input.triggerKey.trim()
    || !legalText(input.triggerKey, 200) || (input.topic != null && !legalText(input.topic, 500))
    || !Number.isFinite(input.dueAt.getTime()) || !Number.isFinite(input.expiresAt.getTime())
    || input.dueAt.getTime() >= input.expiresAt.getTime()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "主动任务的触发、主题或时间无效。" });
  }
}

function settingsInput(input: ProactiveSettings) {
  try {
    const settings = validateSettings(input);
    if (!legalText(settings.stylePrompt, 2000) || settings.timeZone.length > 100) throw new Error("invalid settings");
    return settings;
  }
  catch { throw new TRPCError({ code: "BAD_REQUEST", message: "主动任务设置无效。" }); }
}

const PRE_DISPATCH_REASONS = [
  "model_failed", "empty_generation", "scheduler_stopped", "generation_expired", "text_rejected",
  "web_delivery_rejected", "dispatch_rejected", "cancelled_before_dispatch", "binding_changed", "preflight_rejected",
];
const ATTEMPT_REASONS = ["rejected_by_api", "transport_unconfirmed", "unconfirmed_response", "dispatch_unconfirmed"];

async function preparedDispatch(
  tx: DbTransaction, claim: ProactiveClaim, clock: () => Date, delivery: "web" | "qq", signal?: AbortSignal,
  reserved = false,
) {
  const locked = await lockClaim(tx, claim.job);
  signal?.throwIfAborted();
  if (!locked) return null;
  const { policy, job } = locked;
  const now = clock();
  const expected = reserved
    ? job.status === "unknown" && job.reason === DISPATCH_PENDING && job.attemptedAt !== null
      && job.settledAt === null && job.unknownAcknowledgedAt === null && job.cancelRequestedAt === null
    : job.status === "ready" && job.attemptedAt === null;
  if (!sameClaim(job, claim) || !expected || !job.text || !isDue(job, now)) return null;
  if (expired(job, now)) {
    if (delivery === "web") await expire(tx, job, now);
    return null;
  }
  if (!validPolicy(policy, job) || policy.delivery !== delivery || !await validDelivery(tx, policy)
    || !await canAttempt(tx, policy, now, reserved ? job.id : undefined)) return null;
  const day = localClock(now, policy.timeZone).day;
  const at = clock();
  if (expired(job, at) || !isDue(job, at) || isQuiet(at, policy) || localClock(at, policy.timeZone).day !== day) return null;
  signal?.throwIfAborted();
  return { job, day, at };
}

export function createProactiveRepository(options: { now?: () => Date } = {}): ProactiveRepository {
  const clock = (fallback = new Date()) => options.now?.() ?? fallback;
  return {
    async getPolicy(userId, personaId) {
      const db = await database();
      const scope = { userId, personaId };
      return db.transaction(async tx => {
        await lockOwner(tx, scope);
        return await lockPolicy(tx, scope) ?? {
          ...defaultSettings, times: [...defaultSettings.times], userId, personaId, revision: 0, qqConsent: null,
        };
      });
    },

    async savePolicy(userId, personaId, expectedRevision, input, suppliedConsent) {
      const settings = settingsInput(input);
      const db = await database();
      const scope = { userId, personaId };
      return db.transaction(async tx => {
        await lockOwner(tx, scope);
        const before = await lockPolicy(tx, scope);
        if ((before?.revision ?? 0) !== expectedRevision) throw CONFLICT();
        let consent = settings.delivery === "qq" ? suppliedConsent : null;
        if (settings.delivery === "qq" && !await validQqConsent(tx, scope, consent)) {
          if (settings.enabled) throw STALE();
          consent = null;
        }
        const now = clock();
        const values = {
          ...settings, revision: expectedRevision + 1, updatedAt: now,
          qqConfigId: consent?.configId ?? null, qqGeneration: consent?.generation ?? null, qqTargetId: consent?.targetId ?? null,
        };
        const [saved] = before
          ? await tx.update(policies).set(values).where(and(policyScope(scope), eq(policies.revision, expectedRevision))).returning()
          : await tx.insert(policies).values({ ...scope, ...values }).returning();
        if (!saved) throw CONFLICT();
        await tx.update(jobs).set({ status: "cancelled", reason: "policy_changed", updatedAt: now })
          .where(and(jobScope(scope), inArray(jobs.status, OPEN), isNull(jobs.attemptedAt)));
        return policyDto(saved);
      });
    },

    async listEnabled() {
      const db = await database();
      const rows = await db.select({ policy: policies }).from(policies).innerJoin(personas, and(
        eq(personas.id, policies.personaId), eq(personas.userId, policies.userId), eq(personas.analysisStatus, "ready"),
      )).where(eq(policies.enabled, true)).orderBy(asc(policies.userId), asc(policies.personaId));
      return rows.map(({ policy }) => policyDto(policy));
    },

    async enqueue(userId, personaId, input) {
      checkEnqueue(input);
      const db = await database();
      const scope = { userId, personaId };
      return db.transaction(async tx => {
        await lockOwner(tx, scope);
        const policy = await lockPolicy(tx, scope);
        if (!validPolicy(policy, input) || !await validDelivery(tx, policy)) return null;
        const [inserted] = await tx.insert(jobs).values({
          ...scope, policyRevision: input.policyRevision, kind: input.kind, triggerKey: input.triggerKey, topic: input.topic ?? null,
          dueAt: input.dueAt, expiresAt: input.expiresAt,
        }).onConflictDoNothing({ target: [jobs.userId, jobs.personaId, jobs.triggerKey] }).returning();
        return inserted ? jobDto(inserted) : null;
      });
    },

    async pending(now, limit = 50, afterId = 0) {
      const db = await database();
      const scanAt = clock(now);
      const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 50;
      const readyOwner = and(eq(personas.id, jobs.personaId), eq(personas.userId, jobs.userId), eq(personas.analysisStatus, "ready"));
      const elapsed = await db.select({ id: jobs.id, userId: jobs.userId, personaId: jobs.personaId })
        .from(jobs).innerJoin(personas, readyOwner)
        .where(and(inArray(jobs.status, OPEN), isNull(jobs.attemptedAt), lte(jobs.expiresAt, scanAt)))
        .orderBy(asc(jobs.expiresAt), asc(jobs.id)).limit(bounded);
      // Do not hold more than one owner's locks at once.
      for (const candidate of elapsed) {
        await db.transaction(async tx => {
          const locked = await lockClaim(tx, candidate);
          const checkedAt = clock(now);
          if (locked && expired(locked.job, checkedAt)) await expire(tx, locked.job, checkedAt);
        });
      }
      const readyAt = clock(now);
      const unresolved = alias(jobs, "unresolved_proactive_jobs");
      const blocked = db.select({ id: unresolved.id }).from(unresolved).where(and(
        eq(unresolved.userId, jobs.userId), eq(unresolved.personaId, jobs.personaId),
        eq(unresolved.status, "unknown"), isNull(unresolved.unknownAcknowledgedAt),
      ));
      const rows = await db.select({ job: jobs }).from(jobs).innerJoin(personas, readyOwner).innerJoin(policies, and(
        eq(policies.userId, jobs.userId), eq(policies.personaId, jobs.personaId),
        eq(policies.revision, jobs.policyRevision), eq(policies.enabled, true),
      )).where(and(eq(jobs.status, "pending"), gt(jobs.id, afterId), lte(jobs.dueAt, readyAt),
        gt(jobs.expiresAt, readyAt), notExists(blocked)))
        .orderBy(asc(jobs.id)).limit(bounded);
      return rows.map(({ job }) => jobDto(job));
    },

    async claim(candidate, now) {
      const db = await database();
      return db.transaction(async tx => {
        const locked = await lockClaim(tx, candidate);
        if (!locked) return null;
        const { job, policy } = locked;
        const checkedAt = clock(now);
        if (job.status !== "pending" || job.policyRevision !== candidate.policyRevision) return null;
        if (expired(job, checkedAt)) {
          await expire(tx, job, checkedAt);
          return null;
        }
        if (!isDue(job, checkedAt) || !validPolicy(policy, job) || !await validDelivery(tx, policy)
          || !await canAttempt(tx, policy, checkedAt)) return null;
        const at = clock(now);
        if (expired(job, at)) {
          await expire(tx, job, at);
          return null;
        }
        if (!isDue(job, at) || isQuiet(at, policy) || localClock(at, policy.timeZone).day !== localClock(checkedAt, policy.timeZone).day) return null;
        const token = randomUUID();
        const changed = await writeJob(tx, job, { status: "generating", claimToken: token, updatedAt: at });
        return changed ? { job: jobDto(changed), policy, token } : null;
      });
    },

    async saveText(claim, text, now, signal) {
      if (!text.trim() || !legalText(text, 4000)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "主动消息正文无效。" });
      }
      const db = await database();
      return db.transaction(async tx => {
        const locked = await lockClaim(tx, claim.job);
        signal?.throwIfAborted();
        if (!locked) return false;
        const { job, policy } = locked;
        const checkedAt = clock(now);
        if (job.status !== "generating" || !sameClaim(job, claim) || job.attemptedAt) return false;
        if (expired(job, checkedAt)) {
          await expire(tx, job, checkedAt);
          signal?.throwIfAborted();
          return false;
        }
        if (!validPolicy(policy, job) || !await validDelivery(tx, policy)) return false;
        signal?.throwIfAborted();
        const at = clock(now);
        if (expired(job, at)) {
          await expire(tx, job, at);
          signal?.throwIfAborted();
          return false;
        }
        const saved = await writeJob(tx, job, { status: "ready", text, updatedAt: at });
        signal?.throwIfAborted();
        return Boolean(saved);
      });
    },

    async reserveDispatch(claim, now, signal) {
      const db = await database();
      return db.transaction(async tx => {
        const ready = await preparedDispatch(tx, claim, () => clock(now), "qq", signal);
        if (!ready) return false;
        const { job, day, at } = ready;
        signal?.throwIfAborted();
        // Commit uncertainty before allowing the outer transaction to start remote I/O.
        const changed = await writeJob(tx, job, {
          status: "unknown", reason: DISPATCH_PENDING, attemptedAt: at, localDay: day, updatedAt: at,
        });
        signal?.throwIfAborted();
        return Boolean(changed);
      });
    },

    async guardDispatch(tx, claim, now, signal) {
      const ready = await preparedDispatch(tx, claim, () => clock(now), "qq", signal, true);
      if (!ready) throw STALE();
      const { job, day, at } = ready;
      signal?.throwIfAborted();
      const changed = await writeJob(tx, job, {
        reason: DISPATCH_STARTED, attemptedAt: at, localDay: day, updatedAt: at,
      });
      signal?.throwIfAborted();
      if (!changed) throw STALE();
    },

    async deliverWeb(claim, now, signal) {
      const db = await database();
      return db.transaction(async tx => {
        const ready = await preparedDispatch(tx, claim, () => clock(now), "web", signal);
        if (!ready) return false;
        const { job, day, at } = ready;
        signal?.throwIfAborted();
        const changed = await writeJob(tx, job, {
          status: "confirmed", attemptedAt: at, localDay: day, settledAt: at, updatedAt: at,
          reason: "web_inbox", remoteMessageId: null,
        });
        signal?.throwIfAborted();
        return Boolean(changed);
      });
    },

    async finish(claim, result) {
      const db = await database();
      await db.transaction(async tx => {
        const locked = await lockClaim(tx, claim.job);
        if (!locked) return;
        const { job } = locked;
        if (job.status !== "unknown" || !job.attemptedAt || job.settledAt || !sameClaim(job, claim)) return;
        const now = clock();
        const receipt = result.remoteMessageId;
        const confirmed = job.reason === DISPATCH_STARTED && result.status === "confirmed"
          && !!receipt && /^-?\d{1,40}$/.test(receipt);
        const status = confirmed ? "confirmed" : result.status === "failed" ? "failed" : "unknown";
        const reason = confirmed ? "confirmed_by_api" : ATTEMPT_REASONS.includes(result.reason)
          ? result.reason : status === "failed" ? "rejected_by_api" : "transport_unconfirmed";
        await writeJob(tx, job, {
          status, reason, remoteMessageId: confirmed ? receipt : null, settledAt: now, updatedAt: now,
        });
      });
    },

    async failBeforeDispatch(claim, reason) {
      const db = await database();
      await db.transaction(async tx => {
        const locked = await lockClaim(tx, claim.job);
        if (!locked) return;
        const { job } = locked;
        if (!WORKING.includes(job.status) || job.attemptedAt || !sameClaim(job, claim)) return;
        await writeJob(tx, job, {
          status: reason === "generation_expired" ? "expired" : "failed",
          reason: PRE_DISPATCH_REASONS.includes(reason) ? reason : "before_dispatch_failed", updatedAt: clock(),
        });
      });
    },

    async list(userId, personaId) {
      const db = await database();
      const scope = { userId, personaId };
      return db.transaction(async tx => {
        await lockOwner(tx, scope);
        const unresolved = await tx.select().from(jobs).where(and(
          jobScope(scope), eq(jobs.status, "unknown"), isNull(jobs.unknownAcknowledgedAt),
        )).orderBy(desc(jobs.createdAt), desc(jobs.id));
        const recent = await tx.select().from(jobs).where(jobScope(scope)).orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(50);
        const selected = new Map([...unresolved, ...recent].map(row => [row.id, row]));
        return Array.from(selected.values(), jobDto);
      });
    },

    async cancel(userId, personaId, jobId) {
      const db = await database();
      const scope = { userId, personaId };
      return db.transaction(async tx => {
        await lockOwner(tx, scope);
        await lockPolicy(tx, scope);
        const job = await lockJob(tx, { ...scope, id: jobId });
        if (!job) return false;
        const now = clock();
        if (job.status === "unknown" && job.attemptedAt && !job.settledAt && !job.unknownAcknowledgedAt) {
          if (job.cancelRequestedAt) return true;
          // Stopping a pending dispatch is possible, but an already started request cannot be recalled.
          return Boolean(await writeJob(tx, job, { cancelRequestedAt: now, updatedAt: now }));
        }
        if (!OPEN.includes(job.status) || job.attemptedAt) return false;
        return Boolean(await writeJob(tx, job, { status: "cancelled", reason: "cancelled_by_user", updatedAt: now }));
      });
    },

    async markRead(userId, personaId, jobId) {
      const db = await database();
      const scope = { userId, personaId };
      await db.transaction(async tx => {
        await lockOwner(tx, scope);
        await lockPolicy(tx, scope);
        const job = await lockJob(tx, { ...scope, id: jobId });
        if (!job || job.readAt) return;
        const now = clock();
        await writeJob(tx, job, { readAt: now, updatedAt: now });
      });
    },

    async acknowledgeUnknown(userId, personaId, jobId) {
      const db = await database();
      const scope = { userId, personaId };
      return db.transaction(async tx => {
        await lockOwner(tx, scope);
        await lockPolicy(tx, scope);
        const job = await lockJob(tx, { ...scope, id: jobId });
        if (!job) return false;
        if (job.unknownAcknowledgedAt) return true;
        const now = clock();
        if (job.status !== "unknown" || !job.attemptedAt) return false;
        const lastAttemptActivity = Math.max(job.attemptedAt.getTime(), job.updatedAt.getTime());
        if (!job.settledAt && (!expired(job, now) || now.getTime() - lastAttemptActivity < UNKNOWN_RECOVERY_GRACE_MS)) return false;
        return Boolean(await writeJob(tx, job, { unknownAcknowledgedAt: now, updatedAt: now }));
      });
    },
  };
}
