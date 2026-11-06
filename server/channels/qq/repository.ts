import { and, desc, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { channelBindings, channelStates, personas } from "../../../drizzle/schema";
import {
  qqChannelConfigs as configs, qqDeliveries as deliveries, qqInboundMessages as inbound,
} from "../../../drizzle/qq-channel-schema";
import { decryptSecret } from "../../_core/crypto";
import { getDb, lockQqChannelConfig, type DbTransaction } from "../../db";
import { QqError, type DeliveryStatus, type QqConfig, type QqDelivery } from "./core";

type ConfigFields = Pick<QqConfig, "apiBaseUrl" | "botId" | "targetId" | "personaId" | "secretsEnc">;
type ConfigIdentity = Pick<QqConfig, "id" | "userId" | "generation">;
type Connection = NonNullable<Awaited<ReturnType<typeof getDb>>> | DbTransaction;
const PENDING = "dispatch_pending";
const STARTED = "dispatch_started";

export interface QqRepository {
  get(userId: number): Promise<QqConfig | null>;
  byHook(hookId: string): Promise<QqConfig | null>;
  save(userId: number, expected: number | null, fields: ConfigFields): Promise<QqConfig>;
  enable(userId: number, generation: number): Promise<QqConfig>;
  disable(userId: number, expected: number | null): Promise<void>;
  claimInbound(config: QqConfig, messageId: string): Promise<number | null>;
  finishInbound(config: ConfigIdentity, id: number, status: string): Promise<void>;
  claimDelivery(config: QqConfig, key: string): Promise<number | null>;
  /** start must initiate I/O synchronously, before its first await. */
  dispatchDelivery<T>(config: QqConfig, id: number, start: () => Promise<T>, guard?: (tx: DbTransaction) => Promise<void>): Promise<{ result: Promise<T> }>;
  finishDelivery(userId: number, id: number, status: DeliveryStatus, remoteMessageId: string | null, reason: string): Promise<void>;
  recentDeliveries(userId: number): Promise<QqDelivery[]>;
}

async function database() {
  const db = await getDb();
  if (!db) throw new QqError("PRECONDITION_FAILED", "数据库暂不可用。");
  return db;
}

async function current(connection: Connection, userId: number): Promise<QqConfig | null> {
  const [row] = await connection.select().from(configs).where(eq(configs.userId, userId)).limit(1);
  return row ?? null;
}

const configScope = (config: ConfigIdentity) =>
  and(eq(configs.id, config.id), eq(configs.userId, config.userId), eq(configs.generation, config.generation));
const bindingScope = (userId: number) =>
  and(eq(channelBindings.userId, userId), eq(channelBindings.channel, "qq"));
const targetKey = (targetId: string) => `private:${targetId}`;

function requireVersion(config: QqConfig | null, expected: number | null) {
  if ((config?.generation ?? null) !== expected) {
    throw new QqError("CONFLICT", "QQ 配置已变更，请刷新后重试。");
  }
}

async function requirePersona(tx: DbTransaction, userId: number, personaId: number | null): Promise<number> {
  if (!personaId) throw new QqError("PRECONDITION_FAILED", "请选择当前账号下已就绪的角色。");
  const [persona] = await tx.select({ id: personas.id }).from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId), eq(personas.analysisStatus, "ready")))
    .limit(1).for("share");
  if (!persona) throw new QqError("FORBIDDEN", "角色不可用或不属于当前账号。");
  return persona.id;
}

async function writeChannelState(tx: DbTransaction, userId: number, status: "configured" | "connected" | "stopped") {
  await tx.insert(channelStates).values({ userId, channel: "qq", status })
    .onConflictDoUpdate({
      target: [channelStates.userId, channelStates.channel],
      set: { status, credentialsEnc: null, lastError: null, updatedAt: new Date() },
    });
}

async function requireActiveConfig(tx: DbTransaction, snapshot: QqConfig) {
  const row = await current(tx, snapshot.userId);
  if (!row?.enabled || row.id !== snapshot.id || row.generation !== snapshot.generation
    || row.botId !== snapshot.botId || row.targetId !== snapshot.targetId || row.personaId !== snapshot.personaId
    || row.apiBaseUrl !== snapshot.apiBaseUrl || row.secretsEnc !== snapshot.secretsEnc) {
    throw new QqError("PRECONDITION_FAILED", "QQ 已停用或配置已变更。");
  }
  const personaId = await requirePersona(tx, row.userId, row.personaId);
  const [binding] = await tx.select({ id: channelBindings.id }).from(channelBindings)
    .where(and(bindingScope(row.userId), eq(channelBindings.targetId, targetKey(row.targetId)),
      eq(channelBindings.personaId, personaId), eq(channelBindings.isActive, true)))
    .limit(1);
  if (!binding) throw new QqError("PRECONDITION_FAILED", "QQ 目标绑定已停用或变更。");
  return row;
}

function ownedTargetConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const row = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (row.code === "23505" && row.constraint === "qq_channel_configs_enabled_target_idx") return true;
    current = row.cause;
  }
  return false;
}

export function createQqRepository(): QqRepository {
  return {
    async get(userId) {
      return current(await database(), userId);
    },

    async byHook(hookId) {
      const db = await database();
      const [row] = await db.select().from(configs).where(eq(configs.hookId, hookId)).limit(1);
      return row ?? null;
    },

    async save(userId, expected, fields) {
      // QQ never accepts the legacy plaintext-compatible decrypt path.
      if (!await decryptSecret(fields.secretsEnc)) {
        throw new QqError("BAD_REQUEST", "QQ 凭据必须使用加密格式保存。");
      }
      const db = await database();
      return db.transaction(async tx => {
        await lockQqChannelConfig(tx, userId);
        const before = await current(tx, userId);
        requireVersion(before, expected);
        await requirePersona(tx, userId, fields.personaId);
        const { apiBaseUrl, botId, targetId, personaId, secretsEnc } = fields;
        const values = {
          apiBaseUrl, botId, targetId, personaId, secretsEnc,
          enabled: false, generation: (before?.generation ?? 0) + 1, updatedAt: new Date(),
        };
        const [row] = before
          ? await tx.update(configs).set(values).where(configScope(before)).returning()
          : await tx.insert(configs).values({ ...values, userId, hookId: randomBytes(24).toString("hex") }).returning();
        if (!row) throw new QqError("CONFLICT", "QQ 配置已变更，请刷新后重试。");
        await tx.update(channelBindings).set({ isActive: false }).where(bindingScope(userId));
        await writeChannelState(tx, userId, "configured");
        return row;
      });
    },

    async enable(userId, generation) {
      const db = await database();
      try {
        return await db.transaction(async tx => {
          await lockQqChannelConfig(tx, userId);
          const before = await current(tx, userId);
          requireVersion(before, generation);
          if (!before) throw new QqError("PRECONDITION_FAILED", "请先保存 QQ 配置。");
          const personaId = await requirePersona(tx, userId, before.personaId);
          const [row] = await tx.update(configs).set({ enabled: true, updatedAt: new Date() })
            .where(configScope(before)).returning();
          if (!row) throw new QqError("CONFLICT", "QQ 配置已变更，请刷新后重试。");
          await tx.delete(channelBindings).where(bindingScope(userId));
          await tx.insert(channelBindings).values({
            userId, channel: "qq", targetId: targetKey(row.targetId), personaId, isActive: true,
          });
          await writeChannelState(tx, userId, "connected");
          return row;
        });
      } catch (error) {
        if (ownedTargetConflict(error)) {
          throw new QqError("CONFLICT", "该机器人和私聊目标已由其他连接占用。");
        }
        throw error;
      }
    },

    async disable(userId, expected) {
      const db = await database();
      await db.transaction(async tx => {
        await lockQqChannelConfig(tx, userId);
        const before = await current(tx, userId);
        requireVersion(before, expected);
        if (!before) return;
        const [updated] = await tx.update(configs)
          .set({ enabled: false, generation: before.generation + 1, updatedAt: new Date() })
          .where(configScope(before)).returning({ id: configs.id });
        if (!updated) throw new QqError("CONFLICT", "QQ 配置已变更，请刷新后重试。");
        await tx.update(channelBindings).set({ isActive: false }).where(bindingScope(userId));
        await writeChannelState(tx, userId, "stopped");
      });
    },

    async claimInbound(config, messageId) {
      const db = await database();
      return db.transaction(async tx => {
        await lockQqChannelConfig(tx, config.userId);
        const row = await requireActiveConfig(tx, config);
        const [claim] = await tx.insert(inbound).values({
          configId: row.id, userId: row.userId, configGeneration: row.generation,
          botId: row.botId, targetId: row.targetId, messageId,
        }).onConflictDoNothing({
          target: [inbound.configId, inbound.botId, inbound.targetId, inbound.messageId],
        }).returning({ id: inbound.id });
        return claim?.id ?? null;
      });
    },

    async finishInbound(config, id, status) {
      if (!["done", "ignored", "failed", "cancelled"].includes(status)) {
        throw new QqError("BAD_REQUEST", "无效的入站处理结果。");
      }
      const db = await database();
      await db.update(inbound).set({ status }).where(and(
        eq(inbound.id, id), eq(inbound.configId, config.id), eq(inbound.userId, config.userId),
        eq(inbound.configGeneration, config.generation), eq(inbound.status, "claimed"),
      ));
    },

    async claimDelivery(config, key) {
      const db = await database();
      return db.transaction(async tx => {
        await lockQqChannelConfig(tx, config.userId);
        const row = await requireActiveConfig(tx, config);
        const [claim] = await tx.insert(deliveries).values({
          configId: row.id, userId: row.userId, configGeneration: row.generation,
          botId: row.botId, targetId: row.targetId, deliveryKey: key, status: "unknown", reason: PENDING,
        }).onConflictDoNothing({
          target: [deliveries.configId, deliveries.deliveryKey],
        }).returning({ id: deliveries.id });
        return claim?.id ?? null;
      });
    },

    async dispatchDelivery(config, id, start, guard) {
      const db = await database();
      // Do not retry: the callback may already have started transport if commit fails.
      return db.transaction(async tx => {
        await lockQqChannelConfig(tx, config.userId);
        const row = await requireActiveConfig(tx, config);
        await guard?.(tx);
        const [claim] = await tx.update(deliveries).set({ reason: STARTED, updatedAt: new Date() }).where(and(
          eq(deliveries.id, id), eq(deliveries.configId, row.id), eq(deliveries.userId, row.userId),
          eq(deliveries.configGeneration, row.generation), eq(deliveries.botId, row.botId),
          eq(deliveries.targetId, row.targetId), eq(deliveries.status, "unknown"), eq(deliveries.reason, PENDING),
        )).returning({ id: deliveries.id });
        if (!claim) throw new QqError("PRECONDITION_FAILED", "投递占位已失效或已使用。");
        const result = start();
        void result.catch(() => undefined); // The transaction can fail before handing the promise to the caller.
        return { result }; // Release the DB lock without waiting for the OneBot response.
      });
    },

    async finishDelivery(userId, id, status, remoteMessageId, reason) {
      if (!/^[a-z][a-z0-9_]{0,79}$/.test(reason) || reason === PENDING || reason === STARTED) {
        throw new QqError("BAD_REQUEST", "无效的投递结算原因。");
      }
      if ((status === "confirmed") !== (remoteMessageId !== null)) {
        throw new QqError("BAD_REQUEST", "投递确认必须对应有效回执。");
      }
      const db = await database();
      await db.update(deliveries).set({ status, remoteMessageId, reason, updatedAt: new Date() }).where(and(
        eq(deliveries.id, id), eq(deliveries.userId, userId), eq(deliveries.status, "unknown"),
        status === "confirmed" ? eq(deliveries.reason, STARTED) : inArray(deliveries.reason, [PENDING, STARTED]),
      ));
    },

    async recentDeliveries(userId) {
      const db = await database();
      const rows = await db.select({
        id: deliveries.id, targetId: deliveries.targetId, status: deliveries.status,
        remoteMessageId: deliveries.remoteMessageId, reason: deliveries.reason, createdAt: deliveries.createdAt,
      }).from(deliveries).where(eq(deliveries.userId, userId))
        .orderBy(desc(deliveries.createdAt), desc(deliveries.id)).limit(20);
      return rows.map(row => ({ ...row, status: row.status as DeliveryStatus }));
    },
  };
}
