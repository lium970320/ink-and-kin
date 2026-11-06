import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { channelBindings, personas, roleplayChannels, roleplayMessages } from "../../../drizzle/schema";
import { qqChannelConfigs } from "../../../drizzle/qq-channel-schema";
import {
  qqRoleplayAttempts as attempts, qqRoleplayBatches as batches, qqRoleplayParts as parts,
  qqRoleplayRoutes as routes, type QqRoleplayRetryOperation, type QqRoleplayStoredPartStatus,
} from "../../../drizzle/qq-roleplay-schema";
import { summarizeQqDeliveryParts, type QqDeliveryPart } from "../../../shared/qq-delivery";
import { getDb, lockQqChannelConfig, type DbTransaction } from "../../db";
import { QqError, type DeliveryResult, type QqConfig } from "./core";
import type { QqRoleplayBatchRecord, QqRoleplayBeatInput, QqRoleplayRepository, QqRoleplayTicket } from "./roleplay-types";

type BatchRow = typeof batches.$inferSelect;
type PartRow = typeof parts.$inferSelect;
type Connection = NonNullable<Awaited<ReturnType<typeof getDb>>> | DbTransaction;
type Channel = Pick<typeof roleplayChannels.$inferSelect, "id" | "isActive" | "channelKind" | "generationRevision">;
type AttemptResult = Pick<DeliveryResult, "status" | "remoteMessageId"> & { reason: string | null };

const RECENT_BATCHES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validated = new WeakMap<DbTransaction, QqRoleplayTicket>();
const changed = () => new QqError("PRECONDITION_FAILED", "QQ 频道、绑定或消息上下文已变化，请重新进入。");
const notFound = () => new QqError("NOT_FOUND", "未找到该频道投递批次。");

async function database() {
  const db = await getDb();
  if (!db) throw new QqError("PRECONDITION_FAILED", "数据库暂不可用。");
  return db;
}

function operationUuid(value: string) {
  if (!UUID.test(value)) throw new QqError("BAD_REQUEST", "投递操作编号无效。");
  return value.toLowerCase();
}

function sameRoute(left: QqRoleplayTicket, right: QqRoleplayTicket): boolean {
  return left.userId === right.userId && left.configId === right.configId && left.configGeneration === right.configGeneration
    && left.botId === right.botId && left.targetId === right.targetId && left.channelId === right.channelId
    && left.routeRevision === right.routeRevision;
}

function sameTicket(left: QqRoleplayTicket, right: QqRoleplayTicket): boolean {
  return sameRoute(left, right) && left.channelRevision === right.channelRevision;
}

const bindingMatch = and(
  eq(channelBindings.userId, qqChannelConfigs.userId),
  eq(channelBindings.channel, "qq"),
  eq(channelBindings.targetId, sql`'private:' || ${qqChannelConfigs.targetId}`),
  eq(channelBindings.personaId, qqChannelConfigs.personaId),
  eq(channelBindings.isActive, true),
);
const personaMatch = and(
  eq(personas.id, qqChannelConfigs.personaId),
  eq(personas.userId, qqChannelConfigs.userId),
  eq(personas.analysisStatus, "ready"),
);

async function readRoute(connection: Connection, userId: number): Promise<QqRoleplayTicket | null> {
  const [row] = await connection.select({
    userId: routes.userId, configId: routes.configId, configGeneration: routes.configGeneration,
    botId: routes.botId, targetId: routes.targetId, routeRevision: routes.routeRevision,
    channelId: roleplayChannels.id, channelRevision: roleplayChannels.generationRevision,
  }).from(routes)
    .innerJoin(qqChannelConfigs, and(
      eq(routes.configId, qqChannelConfigs.id), eq(routes.userId, qqChannelConfigs.userId),
      eq(routes.configGeneration, qqChannelConfigs.generation), eq(routes.botId, qqChannelConfigs.botId),
      eq(routes.targetId, qqChannelConfigs.targetId), eq(qqChannelConfigs.enabled, true),
    ))
    .innerJoin(channelBindings, bindingMatch)
    .innerJoin(personas, personaMatch)
    .innerJoin(roleplayChannels, and(
      eq(roleplayChannels.id, routes.channelId), eq(roleplayChannels.userId, routes.userId),
      eq(roleplayChannels.isActive, true), eq(roleplayChannels.channelKind, "channel"),
    ))
    .where(eq(routes.userId, userId)).limit(1);
  return row ?? null;
}

async function requireActiveConfig(tx: DbTransaction, snapshot: QqConfig) {
  const [row] = await tx.select({
    id: qqChannelConfigs.id, generation: qqChannelConfigs.generation, botId: qqChannelConfigs.botId,
    targetId: qqChannelConfigs.targetId, personaId: qqChannelConfigs.personaId,
    apiBaseUrl: qqChannelConfigs.apiBaseUrl, secretsEnc: qqChannelConfigs.secretsEnc,
  }).from(qqChannelConfigs).innerJoin(channelBindings, bindingMatch).innerJoin(personas, personaMatch)
    .where(and(eq(qqChannelConfigs.userId, snapshot.userId), eq(qqChannelConfigs.enabled, true))).limit(1);
  if (!row || row.id !== snapshot.id || row.generation !== snapshot.generation || row.botId !== snapshot.botId
    || row.targetId !== snapshot.targetId || row.personaId !== snapshot.personaId
    || row.apiBaseUrl !== snapshot.apiBaseUrl || row.secretsEnc !== snapshot.secretsEnc) throw changed();
}

async function lockChannel(tx: DbTransaction, userId: number, channelId: number): Promise<Channel | null> {
  const [channel] = await tx.select({
    id: roleplayChannels.id, isActive: roleplayChannels.isActive, channelKind: roleplayChannels.channelKind,
    generationRevision: roleplayChannels.generationRevision,
  }).from(roleplayChannels).where(and(eq(roleplayChannels.userId, userId), eq(roleplayChannels.id, channelId)))
    .limit(1).for("update");
  return channel ?? null;
}

function usableChannel(channel: Channel | null): channel is Channel {
  return !!channel?.isActive && channel.channelKind === "channel";
}

async function verifyLockedTicket(tx: DbTransaction, ticket: QqRoleplayTicket, channel: Channel | null, requireRevision = true) {
  if (!usableChannel(channel) || (requireRevision && channel.generationRevision !== ticket.channelRevision)) throw changed();
  const active = await readRoute(tx, ticket.userId);
  if (!active || !sameRoute(active, ticket) || active.channelRevision !== channel.generationRevision) throw changed();
  return channel;
}

async function lockTicket(tx: DbTransaction, ticket: QqRoleplayTicket) {
  await lockQqChannelConfig(tx, ticket.userId);
  await verifyLockedTicket(tx, ticket, await lockChannel(tx, ticket.userId, ticket.channelId));
}

const batchScope = (userId: number, channelId: number) =>
  and(eq(batches.userId, userId), eq(batches.channelId, channelId));
const batchKey = (userId: number, channelId: number, batchId: string) =>
  and(batchScope(userId, channelId), eq(batches.id, batchId));

async function readBatch(connection: Connection, userId: number, channelId: number, batchId: string, lock = false) {
  if (!UUID.test(batchId)) throw notFound();
  const query = connection.select().from(batches).where(batchKey(userId, channelId, batchId)).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw notFound();
  return row;
}

async function requireTicketBatch(tx: DbTransaction, ticket: QqRoleplayTicket, batchId: string) {
  const row = await readBatch(tx, ticket.userId, ticket.channelId, batchId, true);
  if (!sameTicket(row, ticket)) throw changed();
  const message = await readBeatMessage(tx, ticket, row.messageId);
  if (!message || message.contextOverride === "excluded") throw changed();
  return row;
}

const beatMessageScope = (userId: number, channelId: number) => and(
  eq(roleplayMessages.userId, userId), eq(roleplayMessages.channelId, channelId), eq(roleplayMessages.role, "persona"),
);

async function readBeatMessage(tx: DbTransaction, ticket: QqRoleplayTicket, messageId: number) {
  const [row] = await tx.select({ contextOverride: roleplayMessages.contextOverride }).from(roleplayMessages).where(and(
    beatMessageScope(ticket.userId, ticket.channelId), eq(roleplayMessages.id, messageId),
  )).limit(1);
  return row;
}

async function readRetryableMessageIds(connection: Connection, userId: number, channelId: number, messageIds: number[]) {
  if (!messageIds.length) return new Set<number>();
  const rows = await connection.select({ id: roleplayMessages.id }).from(roleplayMessages).where(and(
    beatMessageScope(userId, channelId), inArray(roleplayMessages.id, Array.from(new Set(messageIds))),
    sql`${roleplayMessages.contextOverride} IS DISTINCT FROM 'excluded'`,
  ));
  return new Set(rows.map(row => row.id));
}

async function canRetryBatch(connection: Connection, row: BatchRow): Promise<boolean> {
  const active = await readRoute(connection, row.userId);
  if (!active || !sameRoute(active, row)) return false;
  return (await readRetryableMessageIds(connection, row.userId, row.channelId, [row.messageId])).has(row.messageId);
}

function dtoPart(row: BatchRow, part: PartRow): QqDeliveryPart {
  return {
    id: part.id, messageId: row.messageId, beatIndex: row.beatIndex, partIndex: part.partIndex, text: part.text,
    status: part.status, attempts: part.attemptCount, ...(part.qqMessageId ? { qqMessageId: part.qqMessageId } : {}),
    ...(part.duplicateRisk ? { duplicateRisk: true } : {}), ...(part.error ? { error: part.error } : {}),
  };
}

function toRecord(row: BatchRow, partRows: PartRow[], retryable = true): QqRoleplayBatchRecord {
  const { id, userId, channelId, configId, configGeneration, botId, targetId, routeRevision, channelRevision,
    source, version, activeOperationId, createdAt, updatedAt } = row;
  const projected = partRows.map(part => dtoPart(row, part));
  return {
    ticket: { userId, channelId, configId, configGeneration, botId, targetId, routeRevision, channelRevision },
    activeOperationId,
    batch: {
      id, userId, channelId, contactId: targetId, source, version, retryable, createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(), parts: projected, summary: summarizeQqDeliveryParts(projected),
    },
  };
}

async function readParts(connection: Connection, batchId: string) {
  return connection.select().from(parts).where(eq(parts.batchId, batchId)).orderBy(asc(parts.partIndex));
}

async function touchBatch(tx: DbTransaction, row: BatchRow,
  patch: Partial<Pick<BatchRow, "activeOperationId" | "retryOperations" | "channelRevision">> = {},
) {
  const [updated] = await tx.update(batches).set({ ...patch, version: row.version + 1, updatedAt: new Date() })
    .where(and(batchKey(row.userId, row.channelId, row.id), eq(batches.version, row.version))).returning();
  if (!updated) throw new QqError("CONFLICT", "投递状态已更新，请刷新后重试。");
  return updated;
}

/** Validate without trimming or changing the fixed text. PostgreSQL stores Unicode scalar values. */
export function validateQqRoleplayBeatTexts(texts: string[]) {
  if (texts.length < 1 || texts.length > 32) throw new QqError("BAD_REQUEST", "每拍需要 1 到 32 段固定文本。");
  for (const text of texts) {
    const points = Array.from(text);
    if (points.length < 1 || points.length > 4000 || points.some(point => {
      const char = point.charCodeAt(0);
      return char === 0 || (point.length === 1 && char >= 0xd800 && char <= 0xdfff);
    })) throw new QqError("BAD_REQUEST", "每段必须是 1 到 4000 个有效字符。");
  }
}

export function firstQqRoleplayUnconfirmed<T extends { status: QqRoleplayStoredPartStatus }>(ordered: T[]): T | undefined {
  return ordered.find(part => part.status !== "sent");
}

/** An explicit rejection never resolves an earlier unknown transport outcome. */
export function projectQqRoleplayAttempts(results: AttemptResult[]): Pick<PartRow, "status" | "qqMessageId" | "error"> {
  const confirmed = results.find(result => result.status === "confirmed");
  if (confirmed) return { status: "sent", qqMessageId: confirmed.remoteMessageId, error: null };
  const uncertain = results.find(result => result.status === "unknown");
  if (uncertain) return { status: "unknown", qqMessageId: null, error: uncertain.reason ?? "unconfirmed_response" };
  const failure = results.find(result => result.reason !== "cancelled_before_dispatch");
  if (!failure && results.length) return { status: "cancelled", qqMessageId: null, error: null };
  return { status: "failed", qqMessageId: null, error: failure?.reason ?? "delivery_failed" };
}

function safeResult(input: DeliveryResult, dispatched: boolean): DeliveryResult {
  if (input.status === "confirmed" && dispatched && input.remoteMessageId && /^-?\d{1,40}$/.test(input.remoteMessageId)) {
    return { status: "confirmed", remoteMessageId: input.remoteMessageId, reason: "confirmed_by_api" };
  }
  if (input.status === "failed") {
    const known = ["rejected_by_api", "route_changed_before_dispatch", "dispatch_rejected"];
    if (!dispatched) known.push("cancelled_before_dispatch");
    return { status: "failed", remoteMessageId: null, reason: known.includes(input.reason) ? input.reason : "delivery_failed" };
  }
  return {
    status: "unknown", remoteMessageId: null,
    reason: input.reason === "transport_unconfirmed" ? "transport_unconfirmed" : "unconfirmed_response",
  };
}

function eligibleRetry(part: PartRow | undefined, allowUnknown: boolean): boolean {
  return part?.status === "pending" || part?.status === "failed" || (part?.status === "unknown" && allowUnknown);
}

export function createQqRoleplayRepository(): QqRoleplayRepository {
  return {
    async getRoute(userId) {
      return readRoute(await database(), userId);
    },

    async setRoute(config, channelId) {
      const db = await database();
      return db.transaction(async tx => {
        await lockQqChannelConfig(tx, config.userId);
        await requireActiveConfig(tx, config);
        const channel = channelId === null ? null : await lockChannel(tx, config.userId, channelId);
        if (channelId !== null && !usableChannel(channel)) {
          throw new QqError("NOT_FOUND", "未找到可用的角色频道。");
        }
        const [before] = await tx.select().from(routes).where(eq(routes.userId, config.userId)).limit(1);
        if (channel && before?.channelId === channelId && before.configId === config.id
          && before.configGeneration === config.generation && before.botId === config.botId && before.targetId === config.targetId) {
          return readRoute(tx, config.userId);
        }
        const next = {
          userId: config.userId, configId: config.id, configGeneration: config.generation,
          botId: config.botId, targetId: config.targetId, channelId,
          routeRevision: (before?.routeRevision ?? 0) + 1, updatedAt: new Date(),
        };
        await tx.insert(routes).values(next).onConflictDoUpdate({ target: routes.userId, set: next });
        return channel ? readRoute(tx, config.userId) : null;
      });
    },

    async validateRoute(tx, ticket) {
      await lockTicket(tx, ticket);
      validated.set(tx, { ...ticket });
    },

    async createBeat(tx, ticket, input: QqRoleplayBeatInput) {
      const checked = validated.get(tx);
      if (!checked || !sameTicket(checked, ticket)) throw changed();
      validateQqRoleplayBeatTexts(input.texts);
      const operationId = operationUuid(input.operationId);
      if (!Number.isSafeInteger(input.beatIndex) || input.beatIndex < 0 || !Number.isSafeInteger(input.messageId) || input.messageId < 1) {
        throw new QqError("BAD_REQUEST", "频道消息编号或拍序无效。");
      }
      const message = await readBeatMessage(tx, ticket, input.messageId);
      if (!message) throw changed();
      const retryable = message.contextOverride !== "excluded";
      const [row] = await tx.insert(batches).values({
        ...ticket, id: randomUUID(), operationId, activeOperationId: operationId,
        originalChannelRevision: ticket.channelRevision,
        messageId: input.messageId, beatIndex: input.beatIndex, source: input.source,
      }).onConflictDoNothing({ target: [batches.userId, batches.channelId, batches.operationId, batches.messageId] }).returning();
      if (!row) {
        const [existing] = await tx.select().from(batches).where(and(
          batchScope(ticket.userId, ticket.channelId), eq(batches.operationId, operationId), eq(batches.messageId, input.messageId),
        )).limit(1);
        if (!existing) throw changed();
        const partRows = await readParts(tx, existing.id);
        if (!sameTicket({ ...existing, channelRevision: existing.originalChannelRevision }, ticket)
          || existing.source !== input.source || existing.beatIndex !== input.beatIndex
          || partRows.length !== input.texts.length || partRows.some((part, index) => part.text !== input.texts[index])) {
          throw new QqError("CONFLICT", "该拍的投递原文或归属已固定。");
        }
        return toRecord(existing, partRows, retryable);
      }
      const partRows = await tx.insert(parts).values(input.texts.map((text, partIndex) => ({
        id: randomUUID(), batchId: row.id, partIndex, text,
        status: retryable ? "pending" as const : "cancelled" as const,
      }))).returning();
      return toRecord(row, partRows.sort((left, right) => left.partIndex - right.partIndex), retryable);
    },

    async recent(userId, channelId) {
      const db = await database();
      return db.transaction(async tx => {
        const scope = batchScope(userId, channelId);
        const latest = await tx.select().from(batches).where(scope).orderBy(desc(batches.createdAt), desc(batches.id)).limit(RECENT_BATCHES);
        const ticket = await readRoute(tx, userId);
        const unresolved = ticket?.channelId === channelId ? await tx.select().from(batches).where(and(
          scope, eq(batches.configId, ticket.configId), eq(batches.configGeneration, ticket.configGeneration),
          eq(batches.routeRevision, ticket.routeRevision),
          eq(batches.botId, ticket.botId), eq(batches.targetId, ticket.targetId),
          sql`EXISTS (SELECT 1 FROM ${parts} WHERE ${parts.batchId} = ${batches.id}
            AND ${parts.status} IN ('pending', 'failed', 'unknown'))`,
        )).orderBy(desc(batches.createdAt), desc(batches.id)) : [];
        const selected = new Map([...unresolved, ...latest].map(row => [row.id, row]));
        if (!selected.size) return [];
        const rows = await tx.select().from(parts).where(inArray(parts.batchId, Array.from(selected.keys()))).orderBy(asc(parts.partIndex));
        const byBatch = new Map<string, PartRow[]>();
        for (const row of rows) {
          const grouped = byBatch.get(row.batchId) ?? [];
          grouped.push(row);
          byBatch.set(row.batchId, grouped);
        }
        const sameRouteRows = ticket ? Array.from(selected.values()).filter(row => sameRoute(ticket, row)) : [];
        const eligibleMessages = await readRetryableMessageIds(tx, userId, channelId, sameRouteRows.map(row => row.messageId));
        return Array.from(selected.values(), row => toRecord(row, byBatch.get(row.id) ?? [],
          !!ticket && sameRoute(ticket, row) && eligibleMessages.has(row.messageId)));
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },

    async get(userId, channelId, batchId) {
      const db = await database();
      return db.transaction(async tx => {
        const row = await readBatch(tx, userId, channelId, batchId);
        return toRecord(row, await readParts(tx, row.id), await canRetryBatch(tx, row));
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },

    async beginRetry(input) {
      const db = await database();
      const { userId, channelId, batchId, expectedVersion, allowUnknown } = input;
      const operationId = operationUuid(input.operationId);
      return db.transaction(async tx => {
        await lockQqChannelConfig(tx, userId);
        const channel = await lockChannel(tx, userId, channelId);
        const row = await readBatch(tx, userId, channelId, batchId, true);
        const partRows = await readParts(tx, row.id);
        const replay = row.retryOperations.find(operation => operation.operationId === operationId);
        if (replay) {
          if (replay.expectedVersion !== expectedVersion || replay.allowUnknown !== allowUnknown) {
            throw new QqError("CONFLICT", "该重试编号已用于不同参数。");
          }
          return { record: toRecord(row, partRows, await canRetryBatch(tx, row)), started: false };
        }
        if (row.operationId === operationId) throw new QqError("CONFLICT", "重试必须使用新的操作编号。");
        // A new explicit retry may renew the channel revision of an otherwise identical live route.
        // Replays above never renew authorization, and old attempts still carry the old ticket.
        const currentChannel = await verifyLockedTicket(tx, row, channel, false);
        const message = await readBeatMessage(tx, row, row.messageId);
        if (!message || message.contextOverride === "excluded") throw changed();
        if (row.version !== expectedVersion) throw new QqError("CONFLICT", "投递状态已更新，请刷新后重试。");
        if (partRows.some(part => part.status === "unknown") && !allowUnknown) {
          throw new QqError("PRECONDITION_FAILED", "存在结果未知的分段，须先确认可能重复投递。");
        }
        if (row.retryOperations.length >= 100) throw new QqError("PRECONDITION_FAILED", "该批次已达重试操作上限。");
        const started = eligibleRetry(firstQqRoleplayUnconfirmed(partRows), allowUnknown);
        const attempt: QqRoleplayRetryOperation = { operationId, expectedVersion, allowUnknown };
        const updated = await touchBatch(tx, row, {
          retryOperations: [...row.retryOperations, attempt],
          channelRevision: currentChannel.generationRevision,
          ...(started ? { activeOperationId: operationId } : {}),
        });
        return { record: toRecord(updated, partRows), started };
      });
    },

    async reserveAttempt(ticket, batchId, partId, operationId) {
      const db = await database();
      operationId = operationUuid(operationId);
      if (!UUID.test(partId)) throw notFound();
      return db.transaction(async tx => {
        await lockTicket(tx, ticket);
        const row = await requireTicketBatch(tx, ticket, batchId);
        if (row.activeOperationId !== operationId) return null;
        const [part] = await tx.select().from(parts).where(and(eq(parts.batchId, row.id), ne(parts.status, "sent")))
          .orderBy(asc(parts.partIndex)).limit(1);
        if (part?.id !== partId) return null;
        const retry = row.retryOperations.find(entry => entry.operationId === operationId);
        if (retry ? !eligibleRetry(part, retry.allowUnknown) : part.status !== "pending") return null;
        const [claim] = await tx.insert(attempts).values({ id: randomUUID(), partId, operationId }).onConflictDoNothing({
          target: [attempts.partId, attempts.operationId],
        }).returning({ id: attempts.id });
        if (!claim) return null;
        await tx.update(parts).set({
          status: "unknown", attemptCount: part.attemptCount + 1, qqMessageId: null,
          duplicateRisk: part.duplicateRisk || part.status === "unknown", error: null,
        }).where(eq(parts.id, part.id));
        await touchBatch(tx, row);
        return claim.id;
      });
    },

    async dispatchAttempt(ticket, batchId, partId, attemptId, start) {
      const db = await database();
      if (!UUID.test(partId) || !UUID.test(attemptId)) throw notFound();
      // Never retry this transaction: I/O may already have started when a commit error arrives.
      return db.transaction(async tx => {
        await lockTicket(tx, ticket);
        const row = await requireTicketBatch(tx, ticket, batchId);
        const [part] = await tx.select({ id: parts.id, status: parts.status }).from(parts)
          .where(and(eq(parts.batchId, row.id), ne(parts.status, "sent"))).orderBy(asc(parts.partIndex)).limit(1);
        if (part?.id !== partId || part.status !== "unknown") throw changed();
        const [claim] = await tx.update(attempts).set({ dispatchedAt: new Date() }).where(and(
          eq(attempts.id, attemptId), eq(attempts.partId, partId), eq(attempts.operationId, row.activeOperationId),
          isNull(attempts.dispatchedAt), isNull(attempts.settledAt),
        )).returning({ id: attempts.id });
        if (!claim) throw changed();
        await touchBatch(tx, row);
        const result = start();
        void result.catch(() => undefined);
        return { result };
      });
    },

    async finishAttempt(userId, attemptId, result) {
      if (!UUID.test(attemptId)) return;
      const db = await database();
      await db.transaction(async tx => {
        const [identity] = await tx.select({ batchId: batches.id, channelId: batches.channelId, partId: parts.id }).from(attempts)
          .innerJoin(parts, eq(parts.id, attempts.partId)).innerJoin(batches, eq(batches.id, parts.batchId))
          .where(and(eq(attempts.id, attemptId), eq(batches.userId, userId))).limit(1);
        if (!identity) return;
        const query = tx.select().from(batches).where(batchKey(userId, identity.channelId, identity.batchId)).limit(1);
        const [row] = await query.for("update");
        if (!row) return; // Account/channel may have been deleted since identifying the historical attempt.
        const [attempt] = await tx.select().from(attempts)
          .where(and(eq(attempts.id, attemptId), eq(attempts.partId, identity.partId))).limit(1);
        if (!attempt || attempt.settledAt) return;
        const clean = safeResult(result, attempt.dispatchedAt !== null);
        await tx.update(attempts).set({ ...clean, settledAt: new Date() }).where(and(
          eq(attempts.id, attempt.id), eq(attempts.partId, identity.partId), isNull(attempts.settledAt),
        ));
        const history = await tx.select({
          status: attempts.status, remoteMessageId: attempts.remoteMessageId, reason: attempts.reason,
        }).from(attempts).where(eq(attempts.partId, identity.partId)).orderBy(desc(attempts.createdAt), desc(attempts.id));
        await tx.update(parts).set(projectQqRoleplayAttempts(history)).where(and(eq(parts.id, identity.partId), eq(parts.batchId, row.id)));
        await touchBatch(tx, row);
      });
    },

    async cancelPending(userId, channelId, batchId) {
      if (batchId !== undefined && !UUID.test(batchId)) return;
      const db = await database();
      await db.transaction(async tx => {
        await lockQqChannelConfig(tx, userId);
        if (!await lockChannel(tx, userId, channelId)) return;
        const rows = await tx.select().from(batches).where(and(
          batchScope(userId, channelId), batchId === undefined ? undefined : eq(batches.id, batchId),
          sql`EXISTS (SELECT 1 FROM ${parts} WHERE ${parts.batchId} = ${batches.id} AND ${parts.status} = 'pending')`,
        )).orderBy(asc(batches.id)).for("update");
        if (!rows.length) return;
        const cancelled = await tx.update(parts).set({ status: "cancelled" }).where(and(
          eq(parts.status, "pending"), inArray(parts.batchId, rows.map(row => row.id)),
        )).returning({ batchId: parts.batchId });
        const changed = new Set(cancelled.map(row => row.batchId));
        for (const row of rows) if (changed.has(row.id)) await touchBatch(tx, row);
      });
    },
  };
}
