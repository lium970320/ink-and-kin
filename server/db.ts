import { eq, desc, and, or, sql, count, sum, gte, lte, ilike, asc, inArray, isNull, gt, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { TRPCError } from "@trpc/server";
import type { UsageRecord, TokenSource } from "./llm/usage";
import {
  InsertUser, users,
  personas, personaFiles, messages,
  wechatBindings, skillJobs, llmConfigs, llmProviderRelays, llmUsageRecords, wechatBotState,
  memories, emotionSnapshots, diaryEntries, scenes, sceneMemoryStates,
  roleplayChannels, roleplayChannelMembers, roleplayMessages,
  chatSummaries, safetyEvents, graduationAssessments,
  channelBindings, channelStates, personaTemplates, personaQuestionnaireAnswers,
  reminderDeliveries, researchProfiles, collectedMessages, collectionSources,
  collectionJobs,
  InsertPersona, InsertPersonaFile, InsertMessage,
  InsertWechatBinding, InsertSkillJob, InsertLlmConfig,
  InsertMemory, InsertEmotionSnapshot, InsertDiaryEntry, InsertScene,
  InsertChatSummary, InsertSafetyEvent, InsertGraduationAssessment,
  InsertChannelBinding, InsertPersonaTemplate, InsertPersonaQuestionnaireAnswer,
  InsertRoleplayChannel, InsertRoleplayChannelMember, InsertRoleplayMessage,
  InsertResearchProfile, InsertCollectedMessage, InsertCollectionSource,
  InsertCollectionJob,
} from "../drizzle/schema";
import { chatContextStates } from "../drizzle/chat-context-schema";
import { qqChannelConfigs } from "../drizzle/qq-channel-schema";
import {
  appendSceneMemoryRecentMessages,
  buildInitialSceneMemoryCache,
  buildInitialSceneMemoryStoryState,
  normalizeSceneMemoryCache,
  normalizeSceneMemoryStoryState,
  type SceneMemoryCache,
  type SceneMemoryStoryState,
} from "./social/scene-memory";
import { shouldDeactivateRoleplayChannelAfterMemberRemoval } from "./social/roleplay-channel-policy";

let _db: ReturnType<typeof drizzle> | null = null;

function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return /econnreset|econnrefused|etimedout|connection terminated|socket hang up|too many clients/.test(msg);
}

export async function getDb() {
  if (_db) return _db;
  if (!process.env.DATABASE_URL) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
      return _db;
    } catch (error) {
      if (attempt < 2 && isTransientDbError(error)) {
        const delay = 100 * Math.pow(2, attempt);
        console.warn(`[Database] Connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      return null;
    }
  }
  return null;
}

export async function withRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (isTransientDbError(err) && attempt < maxRetries) {
        _db = null;
        const delay = 100 * Math.pow(2, attempt);
        console.warn(`[Database] Transient error, reconnecting in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * The transaction handle handed to `withTransaction` callbacks.
 */
export type DbTransaction = Parameters<
  Parameters<ReturnType<typeof drizzle>["transaction"]>[0]
>[0];

/**
 * Runs a set of writes inside a single database transaction.
 *
 * The transaction is wrapped in `withRetry`, so a transient connection
 * failure is retried with a fresh connection instead of failing the write.
 */
export async function withTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return withRetry(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    return db.transaction(async (tx) => fn(tx));
  });
}

// ─── User helpers ───────────────────────────────────────────────────────────

export async function createUser(data: { username: string; passwordHash: string; name: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(users).values({
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
    lastSignedIn: new Date(),
  }).returning({ id: users.id });
  return result.id;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function updateUserLastSignedIn(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, id));
}

export async function updateUserProfile(id: number, data: { name?: string; email?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set(data).where(eq(users.id, id));
}

export async function updateUserPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

/**
 * Bumps the user's token version, retiring every session that was issued
 * before the bump. Used on logout and after a password change.
 */
export async function bumpUserTokenVersion(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, id));
}

/** Serializes QQ configuration changes, sends and deletion of their account or role. */
export async function lockQqChannelConfig(tx: DbTransaction, userId: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ink-and-kin:qq-config'), ${userId})`);
}

/** Deletes account data using explicit cleanup for legacy tables and cascading keys for newer tables. */
export async function deleteUserAccount(id: number) {
  await withTransaction(async (tx) => {
    // 配图发布先锁账号配置再锁 QQ；注销沿用同序，避免与最后一次发布互等。
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ink-and-kin:scene-image-config'), ${id})`);
    await lockQqChannelConfig(tx, id);
    // The QQ configuration owns both the inbound and delivery logs via cascading foreign keys.
    await tx.delete(qqChannelConfigs).where(eq(qqChannelConfigs.userId, id));
    await tx.delete(channelBindings).where(eq(channelBindings.userId, id));
    await tx.delete(channelStates).where(eq(channelStates.userId, id));
    await tx.delete(chatSummaries).where(eq(chatSummaries.userId, id));
    await tx.delete(collectedMessages).where(eq(collectedMessages.userId, id));
    await tx.delete(collectionJobs).where(eq(collectionJobs.userId, id));
    await tx.delete(collectionSources).where(eq(collectionSources.userId, id));
    await tx.delete(diaryEntries).where(eq(diaryEntries.userId, id));
    await tx.delete(emotionSnapshots).where(eq(emotionSnapshots.userId, id));
    await tx.delete(graduationAssessments).where(eq(graduationAssessments.userId, id));
    await tx.delete(llmConfigs).where(eq(llmConfigs.userId, id));
    await tx.delete(memories).where(eq(memories.userId, id));
    await tx.delete(messages).where(eq(messages.userId, id));
    await tx.delete(personaFiles).where(eq(personaFiles.userId, id));
    await tx.delete(personaQuestionnaireAnswers).where(eq(personaQuestionnaireAnswers.userId, id));
    await tx.delete(personaTemplates).where(eq(personaTemplates.userId, id));
    await tx.delete(reminderDeliveries).where(eq(reminderDeliveries.userId, id));
    await tx.delete(researchProfiles).where(eq(researchProfiles.userId, id));
    await tx.delete(safetyEvents).where(eq(safetyEvents.userId, id));
    await tx.delete(scenes).where(eq(scenes.userId, id));
    await tx.delete(sceneMemoryStates).where(eq(sceneMemoryStates.userId, id));
    // 角色频道：消息 → 成员 → 频道，顺序满足外键依赖，也覆盖没有外键的历史数据。
    await tx.delete(roleplayMessages).where(eq(roleplayMessages.userId, id));
    await tx.delete(roleplayChannelMembers).where(eq(roleplayChannelMembers.userId, id));
    await tx.delete(roleplayChannels).where(eq(roleplayChannels.userId, id));
    await tx.delete(skillJobs).where(eq(skillJobs.userId, id));
    await tx.delete(wechatBindings).where(eq(wechatBindings.userId, id));
    await tx.delete(wechatBotState).where(eq(wechatBotState.userId, id));
    await tx.delete(personas).where(eq(personas.userId, id));
    await tx.delete(users).where(eq(users.id, id));
  });
}

export async function getAccountStats(userId: number) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, totalMessages: 0, totalFiles: 0, storageUsed: 0 };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(eq(personas.userId, userId));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(eq(personas.userId, userId));
  const [msgCount] = await db.select({ c: count() }).from(messages).where(eq(messages.userId, userId));
  const [fileCount] = await db.select({ c: count() }).from(personaFiles).where(eq(personaFiles.userId, userId));
  const [fileSize] = await db.select({ s: sum(personaFiles.fileSize) }).from(personaFiles).where(eq(personaFiles.userId, userId));
  return {
    totalPersonas: personaCount?.c || 0,
    totalChats: Number(chatSum?.s) || 0,
    totalMessages: msgCount?.c || 0,
    totalFiles: fileCount?.c || 0,
    storageUsed: Number(fileSize?.s) || 0,
  };
}

export async function exportUserData(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [user] = await db.select({ username: users.username, name: users.name, email: users.email, createdAt: users.createdAt })
    .from(users).where(eq(users.id, userId));
  const personaList = await db.select().from(personas).where(eq(personas.userId, userId));
  const messageList = await db.select().from(messages).where(eq(messages.userId, userId)).orderBy(messages.createdAt);
  return { user, personas: personaList, messages: messageList };
}

// ─── Persona helpers ────────────────────────────────────────────────────────

export async function createPersona(data: InsertPersona) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personas).values(data).returning({ id: personas.id });
  return result.id;
}

export async function getPersonasByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
}

export async function getPersonasWithStats(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const list = await db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
  const result = [];
  for (const p of list) {
    const [lastMsgRow] = await db.select({ content: messages.content, createdAt: messages.createdAt })
      .from(messages).where(eq(messages.personaId, p.id)).orderBy(desc(messages.createdAt)).limit(1);
    const [fileCountRow] = await db.select({ c: count() }).from(personaFiles).where(eq(personaFiles.personaId, p.id));
    const [bindingRow] = await db.select({ c: count() }).from(wechatBindings)
      .where(and(eq(wechatBindings.personaId, p.id), eq(wechatBindings.isActive, true)));
    result.push({
      ...p,
      lastMessage: lastMsgRow ? { content: (lastMsgRow.content || "").slice(0, 60), createdAt: lastMsgRow.createdAt } : null,
      fileCount: fileCountRow?.c || 0,
      wechatBound: (bindingRow?.c || 0) > 0,
    });
  }
  return result;
}

export async function getUserStats(userId: number) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, todayChats: 0, memberSince: new Date() };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(eq(personas.userId, userId));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(eq(personas.userId, userId));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [todayCount] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, today)));
  const [userRow] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  return {
    totalPersonas: personaCount?.c || 0,
    totalChats: Number(chatSum?.s) || 0,
    todayChats: todayCount?.c || 0,
    memberSince: userRow?.createdAt || new Date(),
  };
}

export async function getRecentActivity(userId: number, limit = 8) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: messages.id,
    personaId: messages.personaId,
    role: messages.role,
    content: messages.content,
    createdAt: messages.createdAt,
    personaName: personas.name,
    emotionalState: personas.emotionalState,
  })
    .from(messages)
    .innerJoin(personas, eq(messages.personaId, personas.id))
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.map(r => ({
    ...r,
    content: (r.content || "").slice(0, 80),
  }));
}

export async function getPersonaById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, userId))).limit(1);
  return result[0];
}

export async function updatePersona(id: number, userId: number, data: Partial<InsertPersona>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(personas).set(data).where(and(eq(personas.id, id), eq(personas.userId, userId)));
}

/**
 * Deletes a persona and everything that hangs off it, in one transaction.
 *
 * Ownership is checked *before* anything is deleted. The row deletes are
 * scoped to the persona's owner as well as the persona itself, so a caller
 * who guessed another user's persona id cannot wipe their history — and
 * cannot even delete the rows that belong to it.
 *
 * Covers every table with a `personaId` — the same completeness rule as
 * `deleteUserAccount`, and checked by `server/db-delete-coverage.test.ts`.
 */
/**
 * 删除人物后，把因此只剩一个（或零个）成员的频道自动停用。
 *
 * 与自用版一致：频道必须至少两个人物才能继续「多人生活」，否则生成侧
 * 会拿到一个无法轮转的频道。只按 userId 收窄，不跨用户改别人的频道。
 */
async function deactivateRoleplayChannelsWithTooFewMembers(
  database: DbTransaction,
  userId: number,
  channelIds: number[],
) {
  const uniqueChannelIds = Array.from(new Set(channelIds)).filter(Number.isFinite);
  if (uniqueChannelIds.length === 0) return;

  const memberCounts = await database.select({
    channelId: roleplayChannelMembers.channelId,
    memberCount: count(),
  })
    .from(roleplayChannelMembers)
    .where(and(
      eq(roleplayChannelMembers.userId, userId),
      inArray(roleplayChannelMembers.channelId, uniqueChannelIds),
    ))
    .groupBy(roleplayChannelMembers.channelId);

  const countsByChannel = new Map(memberCounts.map(row => [row.channelId, row.memberCount]));
  const inactiveChannelIds = uniqueChannelIds.filter(channelId => (
    shouldDeactivateRoleplayChannelAfterMemberRemoval(countsByChannel.get(channelId) ?? 0)
  ));
  if (inactiveChannelIds.length === 0) return;

  await database.update(roleplayChannels)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(
      eq(roleplayChannels.userId, userId),
      inArray(roleplayChannels.id, inactiveChannelIds),
    ));
}

export async function deletePersona(id: number, userId: number) {
  // The ownership check comes first: without it, a caller who passed
  // somebody else's persona id would still delete that persona's messages
  // and memories.
  const owned = await getPersonaById(id, userId);
  if (!owned) throw new Error("Persona not found");

  await withTransaction(async (tx) => {
    await lockQqChannelConfig(tx, userId);
    const [disabledQq] = await tx.update(qqChannelConfigs)
      .set({
        personaId: null, enabled: false,
        generation: sql`${qqChannelConfigs.generation} + 1`, updatedAt: new Date(),
      })
      .where(and(eq(qqChannelConfigs.userId, userId), eq(qqChannelConfigs.personaId, id)))
      .returning({ id: qqChannelConfigs.id });
    if (disabledQq) {
      await tx.delete(channelBindings).where(and(eq(channelBindings.userId, userId), eq(channelBindings.channel, "qq")));
      await tx.update(channelStates)
        .set({ status: "stopped", credentialsEnc: null, lastError: null, updatedAt: new Date() })
        .where(and(eq(channelStates.userId, userId), eq(channelStates.channel, "qq")));
    }
    // 阻止并发添加新成员关系；先按编号锁频道，最后才删人物，避免与生成的外键锁反序。
    await lockRoleplayMembershipChanges(tx, userId);
    const memberChannels = await tx.selectDistinct({ channelId: roleplayChannelMembers.channelId })
      .from(roleplayChannelMembers)
      .where(and(eq(roleplayChannelMembers.personaId, id), eq(roleplayChannelMembers.userId, userId)));
    const historyChannels = await tx.selectDistinct({ channelId: roleplayMessages.channelId })
      .from(roleplayMessages)
      .where(and(eq(roleplayMessages.personaId, id), eq(roleplayMessages.userId, userId)));
    const affectedIds = Array.from(new Set([...memberChannels, ...historyChannels].map(row => row.channelId)));
    const affectedRoleplayChannelIds = affectedIds.length === 0 ? [] : (await tx.select({ id: roleplayChannels.id })
      .from(roleplayChannels)
      .where(and(eq(roleplayChannels.userId, userId), inArray(roleplayChannels.id, affectedIds)))
      .orderBy(asc(roleplayChannels.id))
      .for("update")).map(row => row.id);
    await tx.delete(channelBindings).where(and(eq(channelBindings.personaId, id), eq(channelBindings.userId, userId)));
    await tx.delete(chatSummaries).where(and(eq(chatSummaries.personaId, id), eq(chatSummaries.userId, userId)));
    await tx.delete(collectedMessages).where(and(eq(collectedMessages.personaId, id), eq(collectedMessages.userId, userId)));
    await tx.delete(collectionJobs).where(and(eq(collectionJobs.personaId, id), eq(collectionJobs.userId, userId)));
    await tx.delete(diaryEntries).where(and(eq(diaryEntries.personaId, id), eq(diaryEntries.userId, userId)));
    await tx.delete(emotionSnapshots).where(and(eq(emotionSnapshots.personaId, id), eq(emotionSnapshots.userId, userId)));
    await tx.delete(graduationAssessments).where(and(eq(graduationAssessments.personaId, id), eq(graduationAssessments.userId, userId)));
    await tx.delete(memories).where(and(eq(memories.personaId, id), eq(memories.userId, userId)));
    await tx.delete(messages).where(and(eq(messages.personaId, id), eq(messages.userId, userId)));
    await tx.delete(personaFiles).where(and(eq(personaFiles.personaId, id), eq(personaFiles.userId, userId)));
    await tx.delete(personaQuestionnaireAnswers).where(and(eq(personaQuestionnaireAnswers.personaId, id), eq(personaQuestionnaireAnswers.userId, userId)));
    await tx.delete(reminderDeliveries).where(and(eq(reminderDeliveries.personaId, id), eq(reminderDeliveries.userId, userId)));
    await tx.delete(researchProfiles).where(and(eq(researchProfiles.personaId, id), eq(researchProfiles.userId, userId)));
    await tx.delete(safetyEvents).where(and(eq(safetyEvents.personaId, id), eq(safetyEvents.userId, userId)));
    await tx.delete(sceneMemoryStates).where(and(eq(sceneMemoryStates.personaId, id), eq(sceneMemoryStates.userId, userId)));
    // 角色频道：删掉人物发言与成员关系，重置所有受影响频道的派生状态与生成版本。
    await tx.delete(roleplayMessages).where(and(eq(roleplayMessages.personaId, id), eq(roleplayMessages.userId, userId)));
    await tx.delete(roleplayChannelMembers).where(and(eq(roleplayChannelMembers.personaId, id), eq(roleplayChannelMembers.userId, userId)));
    for (const channelId of affectedRoleplayChannelIds) {
      await resetRoleplayHistoryDerivatives(tx, channelId, userId);
    }
    await deactivateRoleplayChannelsWithTooFewMembers(tx, userId, affectedRoleplayChannelIds);
    await tx.delete(skillJobs).where(and(eq(skillJobs.personaId, id), eq(skillJobs.userId, userId)));
    await tx.delete(wechatBindings).where(and(eq(wechatBindings.personaId, id), eq(wechatBindings.userId, userId)));
    await tx.delete(personas).where(and(eq(personas.id, id), eq(personas.userId, userId)));
  });
}

// ─── PersonaFile helpers ────────────────────────────────────────────────────

export async function createPersonaFile(data: InsertPersonaFile) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaFiles).values(data).returning({ id: personaFiles.id });
  return result.id;
}

export async function getFilesByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personaFiles)
    .where(and(eq(personaFiles.personaId, personaId), eq(personaFiles.userId, userId)))
    .orderBy(desc(personaFiles.createdAt));
}

// ─── Message helpers ────────────────────────────────────────────────────────

export async function createMessage(data: InsertMessage, tx?: DbTransaction) {
  const db = tx ?? await getDb();
  if (!db) throw new Error("DB not available");
  // 消息模式由归属推导：带 sceneId 的是场景消息，其余是日常消息。
  // 日常上下文只读 mode='daily'，场景上下文只读 sceneId，二者互不串线。
  const payload = {
    ...data,
    mode: data.mode ?? (data.sceneId ? "scene" : "daily"),
  };
  const [result] = await db.insert(messages).values(payload).returning({ id: messages.id });
  return result.id;
}

export async function getMessagesByPersonaId(personaId: number, userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt)).limit(limit);
  return rows.reverse();
}

export async function clearMessagesByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(messages).where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)));
}

export async function searchMessages(personaId: number, userId: number, query: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), ilike(messages.content, `%${query}%`)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}

// ─── WeChat Binding helpers ─────────────────────────────────────────────────

export async function createWechatBinding(data: InsertWechatBinding) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(wechatBindings).values(data).returning({ id: wechatBindings.id });
  await syncWechatChannelBinding({
    userId: data.userId,
    wechatUserId: data.wechatUserId,
    personaId: data.personaId,
    wechatName: data.wechatName ?? null,
  });
  return result.id;
}

export async function getWechatBindingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(wechatBindings).where(eq(wechatBindings.userId, userId));
}

/**
 * Finds the default persona binding for a WeChat conversation.
 *
 * `wechatUserId` is the iLink conversation counterpart id — in the official
 * ClawBot model this is the account owner's own Weixin id.
 */
export async function getWechatBindingByUserId(wechatUserId: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wechatBindings)
    .where(and(
      eq(wechatBindings.wechatUserId, wechatUserId),
      eq(wechatBindings.userId, userId),
      eq(wechatBindings.isActive, true),
    )).limit(1);
  return result[0];
}

/**
 * Sets the default persona for a WeChat conversation, replacing any existing
 * binding for the same (user, wechatUserId) pair.
 */
export async function setWechatBindingPersona(params: {
  userId: number;
  wechatUserId: string;
  personaId: number;
  wechatName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const existing = await db.select().from(wechatBindings).where(and(
    eq(wechatBindings.wechatUserId, params.wechatUserId),
    eq(wechatBindings.userId, params.userId),
  )).limit(1);

  if (existing[0]) {
    await db.update(wechatBindings).set({
      personaId: params.personaId,
      isActive: true,
      ...(params.wechatName != null ? { wechatName: params.wechatName } : {}),
    }).where(eq(wechatBindings.id, existing[0].id));
    await syncWechatChannelBinding(params);
    return existing[0].id;
  }

  const [result] = await db.insert(wechatBindings).values({
    userId: params.userId,
    wechatUserId: params.wechatUserId,
    personaId: params.personaId,
    wechatName: params.wechatName ?? null,
    isActive: true,
  }).returning({ id: wechatBindings.id });
  await syncWechatChannelBinding(params);
  return result.id;
}

/**
 * Mirrors a WeChat binding into the channel-neutral table.
 *
 * The WeChat channel keeps its own table for one more release, but the
 * reminder scheduler and the Feishu adapter work in channel-neutral terms —
 * they read `channel_bindings`. Without this mirror a WeChat account bound
 * after the channel layer landed would never receive a channel reminder.
 */
async function syncWechatChannelBinding(params: {
  userId: number;
  wechatUserId: string;
  personaId: number;
  wechatName?: string | null;
}) {
  const db = await getDb();
  if (!db) return;

  const existing = await db.select().from(channelBindings).where(and(
    eq(channelBindings.userId, params.userId),
    eq(channelBindings.channel, "wechat"),
    eq(channelBindings.targetId, params.wechatUserId),
  )).limit(1);

  if (existing[0]) {
    await db.update(channelBindings).set({
      personaId: params.personaId,
      isActive: true,
      ...(params.wechatName != null ? { targetName: params.wechatName } : {}),
    }).where(eq(channelBindings.id, existing[0].id));
    return;
  }

  await db.insert(channelBindings).values({
    userId: params.userId,
    channel: "wechat",
    targetId: params.wechatUserId,
    targetName: params.wechatName ?? null,
    personaId: params.personaId,
    isActive: true,
  }).onConflictDoNothing();
}

export async function deleteWechatBinding(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(wechatBindings).where(and(eq(wechatBindings.id, id), eq(wechatBindings.userId, userId)));
}

// ─── Skill Job helpers ──────────────────────────────────────────────────────

export async function createSkillJob(data: InsertSkillJob) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(skillJobs).values(data).returning({ id: skillJobs.id });
  return result.id;
}

export async function getSkillJobById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(skillJobs)
    .where(and(eq(skillJobs.id, id), eq(skillJobs.userId, userId))).limit(1);
  return result[0];
}

export async function updateSkillJob(
  id: number,
  userId: number,
  data: Partial<InsertSkillJob>,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(skillJobs).set(data)
    .where(and(eq(skillJobs.id, id), eq(skillJobs.userId, userId)));
}

// ─── LLM Config helpers ────────────────────────────────────────────────────

export async function getLlmConfigsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(llmConfigs).where(eq(llmConfigs.userId, userId)).orderBy(asc(llmConfigs.id));
}

export function normalizeLlmProviderName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 64) throw new Error("Invalid provider name");
  return name;
}
function providerWhere(userId: number, name: string) {
  return and(eq(llmConfigs.userId, userId), sql`lower(btrim(${llmConfigs.providerName})) = ${name.trim().toLowerCase()}`);
}
async function lockLlmConfig(tx: any, userId: number) { await tx.execute(sql`select pg_advisory_xact_lock(714009, ${userId})`); }
function configExtra(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
async function upsertLlmConfigInTransaction(tx: any, userId: number, data: Partial<InsertLlmConfig> & { providerName: string }): Promise<number> {
  const providerName = normalizeLlmProviderName(data.providerName);
  const [existing] = await tx.select().from(llmConfigs).where(providerWhere(userId, providerName)).limit(1);
  const [currentDefault] = await tx.select({ id: llmConfigs.id }).from(llmConfigs).where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true))).limit(1);
  const fields: Partial<InsertLlmConfig> = { providerName };
  for (const key of ["baseUrl", "model", "systemMessage", "apiKeyHint"] as const) if (data[key] !== undefined) fields[key] = data[key];
  // Empty credentials mean keep the existing encrypted value.
  if (data.apiKey?.trim()) fields.apiKey = data.apiKey;
  if (data.extraConfig !== undefined) fields.extraConfig = { ...configExtra(existing?.extraConfig), ...configExtra(data.extraConfig) };
  fields.isDefault = !currentDefault || existing?.isDefault === true;
  if (existing) {
    await tx.update(llmConfigs).set(fields).where(and(eq(llmConfigs.id, existing.id), eq(llmConfigs.userId, userId)));
    return existing.id;
  }
  const [row] = await tx.insert(llmConfigs).values({ ...fields, userId, providerName }).returning({ id: llmConfigs.id });
  return row.id;
}

export async function upsertLlmConfig(userId: number, data: Partial<InsertLlmConfig> & { providerName: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async tx => { await lockLlmConfig(tx, userId); return upsertLlmConfigInTransaction(tx, userId, data); });
}

export async function setDefaultLlmConfig(userId: number, providerName: string) {
  await withTransaction(async (tx) => {
    await lockLlmConfig(tx, userId);
    const id = await upsertLlmConfigInTransaction(tx, userId, { providerName });
    await tx.update(llmConfigs).set({ isDefault: false }).where(eq(llmConfigs.userId, userId));
    await tx.update(llmConfigs).set({ isDefault: true })
      .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.id, id)));
    await tx.update(personas).set({ llmProvider: null }).where(eq(personas.userId, userId));
  });
}

export async function getDefaultLlmConfig(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true))).limit(1);
  return rows[0] ?? null;
}

/** Pure read: no hidden migration of parent credentials into a relay. */
export async function getLlmRelaysByUserId(userId: number, providerName?: string) {
  const db = await getDb(); if (!db) return [];
  const conditions = [eq(llmProviderRelays.userId, userId), eq(llmConfigs.userId, userId)];
  if (providerName) conditions.push(sql`lower(btrim(${llmConfigs.providerName})) = ${providerName.trim().toLowerCase()}`);
  const rows = await db.select({ relay: llmProviderRelays, providerName: llmConfigs.providerName }).from(llmProviderRelays)
    .innerJoin(llmConfigs, eq(llmConfigs.id, llmProviderRelays.llmConfigId)).where(and(...conditions))
    .orderBy(desc(llmProviderRelays.priority), asc(llmProviderRelays.id));
  return rows.map(({ relay, providerName }) => ({ ...relay, providerName, extraConfig: { ...configExtra(relay.extraConfig), reasoningEffort: relay.reasoningEffort } }));
}

export async function saveLlmRelayConfig(userId: number, data: {
  id?: number; providerName: string; relayName: string; priority: number; enabled: boolean;
  apiKey?: string; apiKeyHint?: string | null; baseUrl?: string | null; model?: string | null;
  reasoningEffort?: string | null;
}) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    await lockLlmConfig(tx, userId);
    const parentId = await upsertLlmConfigInTransaction(tx, userId, { providerName: data.providerName });
    const fields = { relayName: data.relayName, priority: data.priority, enabled: data.enabled,
      ...(data.apiKey?.trim() ? { apiKey: data.apiKey, apiKeyHint: data.apiKeyHint ?? null } : {}),
      ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}), ...(data.model !== undefined ? { model: data.model } : {}),
      ...(data.reasoningEffort !== undefined ? { reasoningEffort: data.reasoningEffort } : {}), updatedAt: new Date() };
    if (data.id !== undefined) {
      const [existing] = await tx.select().from(llmProviderRelays).where(and(eq(llmProviderRelays.id, data.id), eq(llmProviderRelays.userId, userId))).limit(1);
      if (!existing || existing.llmConfigId !== parentId) throw new Error("LLM_RELAY_NOT_FOUND");
      await tx.update(llmProviderRelays).set(fields).where(and(eq(llmProviderRelays.id, data.id), eq(llmProviderRelays.userId, userId)));
      return data.id;
    }
    const [row] = await tx.insert(llmProviderRelays).values({ ...fields, userId, llmConfigId: parentId }).returning({ id: llmProviderRelays.id });
    return row.id;
  });
}
export async function deleteLlmRelayConfig(id: number, userId: number) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  return db.transaction(async tx => {
    await lockLlmConfig(tx, userId);
    const [removed] = await tx.delete(llmProviderRelays).where(and(eq(llmProviderRelays.id, id), eq(llmProviderRelays.userId, userId))).returning({ configId: llmProviderRelays.llmConfigId });
    if (!removed) return false;
    const [remaining] = await tx.select({ id: llmProviderRelays.id }).from(llmProviderRelays).where(and(eq(llmProviderRelays.llmConfigId, removed.configId), eq(llmProviderRelays.userId, userId))).limit(1);
    if (!remaining) await tx.update(llmConfigs).set({ apiKey: null, apiKeyHint: null, baseUrl: null, model: null }).where(and(eq(llmConfigs.id, removed.configId), eq(llmConfigs.userId, userId)));
    return true;
  });
}

// ─── User-scoped LLM usage metadata ────────────────────────────────────────
export type LlmUsageDetailQuery = {
  userId: number; from?: Date | string; to?: Date | string; personaId?: number | null;
  route?: string; provider?: string; purpose?: string; success?: boolean; limit?: number;
};
export type LlmUsagePeriodSummary = {
  calls: number; successfulCalls: number; failedCalls: number; cancelledCalls: number;
  inputTokens: number; outputTokens: number; totalTokens: number; averageDurationMs: number;
  providerReportedCalls: number; estimatedCalls: number; mixedCalls: number;
};
function usageNumber(value: number) { return Number.isFinite(value) ? Math.min(2147483647, Math.max(0, Math.floor(value))) : 0; }
function usageMetadata(value: string | undefined, max: number) {
  return value && value.length <= max && !Array.from(value).some(char => char.charCodeAt(0) < 32)
    && !/[<>"'=?&#@]/.test(value) && !/:\/\/|sk-|bearer|token=|key=/i.test(value) ? value : null;
}
function tokenSource(value: TokenSource | undefined): TokenSource { return value === "provider" || value === "mixed" ? value : "estimated"; }
export async function createLlmUsageRecord(record: UsageRecord): Promise<void> {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const startedAt = new Date(record.startedAt);
  if (!Number.isFinite(startedAt.getTime())) throw new Error("Invalid usage timestamp");
  const userId = record.userId ?? null;
  if (userId !== null && (!Number.isSafeInteger(userId) || userId <= 0)) throw new Error("Invalid usage owner");
  let personaId: number | null = null; let relayId: number | null = null;
  if (userId !== null && record.personaId != null) {
    const rows = await db.select({ id: personas.id }).from(personas).where(and(eq(personas.id, record.personaId), eq(personas.userId, userId))).limit(1);
    personaId = rows[0]?.id ?? null;
  }
  if (userId !== null && record.relayId != null) {
    const rows = await db.select({ id: llmProviderRelays.id }).from(llmProviderRelays).where(and(eq(llmProviderRelays.id, record.relayId), eq(llmProviderRelays.userId, userId))).limit(1);
    relayId = rows[0]?.id ?? null;
  }
  const attemptedProviders = (record.attemptedProviders ?? []).map(value => usageMetadata(value, 64) ?? "unknown");
  const attemptedIds = (record.attemptedRelayIds ?? []).filter(value => Number.isSafeInteger(value) && value > 0);
  const ownedIds = userId !== null && attemptedIds.length
    ? new Set((await db.select({ id: llmProviderRelays.id }).from(llmProviderRelays)
      .where(and(eq(llmProviderRelays.userId, userId), inArray(llmProviderRelays.id, attemptedIds)))).map(row => row.id))
    : new Set<number>();
  const attemptedRelayIds = attemptedIds.filter(id => ownedIds.has(id));
  const status = record.status === "cancelled" ? "cancelled" : record.status === "failed" || !record.success ? "failed" : "success";
  const error = ["provider_error", "cancelled", "consumer_closed"].includes(record.error ?? "") ? record.error : record.error ? "provider_error" : null;
  await db.insert(llmUsageRecords).values({
    startedAt, userId, personaId, relayId, durationMs: usageNumber(record.durationMs),
    provider: usageMetadata(record.provider, 64) ?? "unknown", requestedProvider: usageMetadata(record.requestedProvider, 64), model: usageMetadata(record.model, 128),
    reasoningEffort: usageMetadata(record.reasoningEffort, 32), purpose: usageMetadata(record.purpose, 64), route: usageMetadata(record.route, 128),
    streaming: record.streaming === true, status, success: status === "success", attempts: usageNumber(record.attempts), attemptedProviders, attemptedRelayIds,
    inputTokens: usageNumber(record.inputTokens), outputTokens: usageNumber(record.outputTokens), totalTokens: usageNumber(record.totalTokens),
    inputChars: usageNumber(record.inputChars), outputChars: usageNumber(record.outputChars),
    usageSource: tokenSource(record.usageSource), inputSource: tokenSource(record.inputSource), outputSource: tokenSource(record.outputSource), totalSource: tokenSource(record.totalSource), error,
  });
}
function usageDate(value: Date | string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid usage date filter");
  return date;
}
function usageWhere(query: LlmUsageDetailQuery) {
  if (!Number.isSafeInteger(query.userId) || query.userId <= 0) throw new Error("Usage queries require an explicit user owner");
  const conditions: SQL[] = [eq(llmUsageRecords.userId, query.userId)];
  const from = usageDate(query.from); const to = usageDate(query.to);
  if (from) conditions.push(gte(llmUsageRecords.startedAt, from));
  if (to) conditions.push(lte(llmUsageRecords.startedAt, to));
  if (from && to && from > to) throw new Error("Invalid usage date range");
  if (query.personaId !== undefined) conditions.push(query.personaId === null ? sql`${llmUsageRecords.personaId} IS NULL` : eq(llmUsageRecords.personaId, query.personaId));
  for (const key of ["provider", "route", "purpose"] as const) if (query[key]?.trim()) {
    const term = query[key]!.trim().replace(/[\\%_]/g, "\\$&");
    conditions.push(ilike(llmUsageRecords[key], `%${term}%`));
  }
  if (query.success !== undefined) conditions.push(eq(llmUsageRecords.success, query.success));
  return and(...conditions)!;
}
const usageSummarySelection = {
  calls: count(), successfulCalls: sql<number>`count(*) filter (where ${llmUsageRecords.success})::int`,
  cancelledCalls: sql<number>`count(*) filter (where ${llmUsageRecords.status} = 'cancelled')::int`,
  inputTokens: sum(llmUsageRecords.inputTokens), outputTokens: sum(llmUsageRecords.outputTokens), totalTokens: sum(llmUsageRecords.totalTokens),
  averageDurationMs: sql<number>`coalesce(avg(${llmUsageRecords.durationMs}), 0)`,
  providerReportedCalls: sql<number>`count(*) filter (where ${llmUsageRecords.usageSource} = 'provider')::int`,
  estimatedCalls: sql<number>`count(*) filter (where ${llmUsageRecords.usageSource} = 'estimated')::int`, mixedCalls: sql<number>`count(*) filter (where ${llmUsageRecords.usageSource} = 'mixed')::int`,
};
function usageSummary(row: any): LlmUsagePeriodSummary {
  const result = Object.fromEntries(Object.keys(usageSummarySelection).map(key => [key, Math.round(Number(row?.[key] ?? 0))]));
  return { ...result, failedCalls: Math.max(0, result.calls - result.successfulCalls) } as LlmUsagePeriodSummary;
}
function usageDto(row: typeof llmUsageRecords.$inferSelect): UsageRecord {
  return { id: row.id, startedAt: row.startedAt.toISOString(), durationMs: row.durationMs,
    provider: row.provider, requestedProvider: row.requestedProvider ?? undefined, model: row.model ?? undefined, reasoningEffort: row.reasoningEffort ?? undefined,
    purpose: row.purpose ?? undefined, userId: row.userId ?? undefined, personaId: row.personaId ?? undefined, relayId: row.relayId ?? undefined, route: row.route ?? undefined,
    streaming: row.streaming, success: row.success, status: row.status as UsageRecord["status"], attempts: row.attempts,
    attemptedProviders: row.attemptedProviders, attemptedRelayIds: row.attemptedRelayIds,
    inputTokens: row.inputTokens, outputTokens: row.outputTokens, totalTokens: row.totalTokens, inputChars: row.inputChars, outputChars: row.outputChars,
    usageSource: tokenSource(row.usageSource as TokenSource), inputSource: tokenSource(row.inputSource as TokenSource), outputSource: tokenSource(row.outputSource as TokenSource), totalSource: tokenSource(row.totalSource as TokenSource), error: (row.error ?? undefined) as UsageRecord["error"],
  };
}
export async function getPersistentLlmUsageDetails(query: LlmUsageDetailQuery) {
  const where = usageWhere(query); const db = await getDb(); if (!db) return null;
  const limit = Math.min(200, Math.max(1, Math.floor(query.limit ?? 50)));
  const [summaryRows, rows] = await Promise.all([
    db.select(usageSummarySelection).from(llmUsageRecords).where(where),
    db.select().from(llmUsageRecords).where(where).orderBy(desc(llmUsageRecords.startedAt), desc(llmUsageRecords.id)).limit(limit),
  ]);
  return { source: "database" as const, filters: { ...query, from: usageDate(query.from)?.toISOString(), to: usageDate(query.to)?.toISOString(), limit }, summary: usageSummary(summaryRows[0]), records: rows.map(usageDto) };
}
export async function getPersistentLlmUsageSnapshot(filters: { userId: number; now?: Date }) {
  usageWhere({ userId: filters.userId });
  const db = await getDb(); if (!db) return null;
  const now = filters.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid usage snapshot time");
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  async function summary(since: Date) { const rows = await db!.select(usageSummarySelection).from(llmUsageRecords).where(usageWhere({ userId: filters.userId, from: since, to: now })); return usageSummary(rows[0]); }
  async function bucket(key: "provider" | "purpose" | "userId" | "personaId" | "route") {
    const column = llmUsageRecords[key];
    const rows = await db!.select({ value: column, ...usageSummarySelection }).from(llmUsageRecords).where(usageWhere({ userId: filters.userId, from: today, to: now }))
      .groupBy(column).orderBy(desc(count()), desc(sum(llmUsageRecords.totalTokens))).limit(12);
    return rows.map(row => ({ name: row.value == null ? "unassigned" : String(row.value), [key]: row.value, ...usageSummary(row) }));
  }
  const [todaySummary, week, month, byProvider, byPurpose, byUser, byPersona, byRoute, recent] = await Promise.all([
    summary(today), summary(new Date(today.getTime() - 6 * 86400000)), summary(new Date(today.getTime() - 29 * 86400000)),
    bucket("provider"), bucket("purpose"), bucket("userId"), bucket("personaId"), bucket("route"),
    db.select().from(llmUsageRecords).where(usageWhere({ userId: filters.userId, to: now })).orderBy(desc(llmUsageRecords.startedAt), desc(llmUsageRecords.id)).limit(20),
  ]);
  return { source: "database" as const, today: todaySummary, week, month, byProvider, byPurpose, byUser, byPersona, byRoute, recent: recent.map(usageDto) };
}

// ─── Daily Activity helpers ────────────────────────────────────────────────

export async function getDailyChatCounts(userId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const rows = await db.select({
    date: sql<string>`DATE(${messages.createdAt})`,
    count: count(),
  })
    .from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`DATE(${messages.createdAt})`);
  return rows;
}

// ─── WeChat Bot State helpers ───────────────────────────────────────────────

export async function getWechatBotState(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  return result[0];
}

/** Lists the ids of all users, used to restore per-user channel state on boot. */
export async function getAllUserIds(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map((r) => r.id);
}

export type WechatBotStateUpdate = Partial<{
  status: string;
  qrCodeUrl: string | null;
  loggedInUser: string | null;
  lastError: string | null;
  botTokenEnc: string | null;
  accountId: string | null;
  baseUrl: string | null;
  wechatUserId: string | null;
  syncBuf: string | null;
  lastInboundAt: Date | null;
}>;

export async function upsertWechatBotState(userId: number, data: WechatBotStateUpdate) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  if (existing[0]) {
    await db.update(wechatBotState).set(data as any).where(eq(wechatBotState.id, existing[0].id));
    return existing[0].id;
  }
  const [result] = await db.insert(wechatBotState).values({ userId, ...data } as any).returning({ id: wechatBotState.id });
  return result.id;
}

/** Persists the long-poll cursor so restarts do not lose inbound messages. */
export async function saveWechatSyncBuf(userId: number, syncBuf: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  if (existing[0]) {
    await db.update(wechatBotState).set({ syncBuf }).where(eq(wechatBotState.id, existing[0].id));
    return;
  }
  await db.insert(wechatBotState).values({ userId, syncBuf } as any);
}

/** Records the timestamp of the last inbound message (24h keep-alive check). */
export async function touchWechatLastInbound(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  if (existing[0]) {
    await db.update(wechatBotState).set({ lastInboundAt: new Date() }).where(eq(wechatBotState.id, existing[0].id));
  }
}

// ─── Intimacy helpers ─────────────────────────────────────────────────────

export async function getIntimacyData(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const persona = await db.select({ chatCount: personas.chatCount, createdAt: personas.createdAt }).from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  if (!persona[0]) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const [msgCount] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)));
  const [memCount] = await db.select({ c: count() }).from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)));
  const emotionRows = await db.select({ s: emotionSnapshots.emotionalState }).from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId)))
    .groupBy(emotionSnapshots.emotionalState);
  const daysSinceCreation = Math.floor((Date.now() - new Date(persona[0].createdAt).getTime()) / 86400000);
  const recentDays = await db.select({ d: sql<string>`DATE(${messages.createdAt})` }).from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .groupBy(sql`DATE(${messages.createdAt})`).orderBy(desc(sql`DATE(${messages.createdAt})`)).limit(30);
  let consecutiveDays = 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < recentDays.length; i++) {
    const expected = new Date(today); expected.setDate(expected.getDate() - i);
    if (recentDays[i].d === expected.toISOString().slice(0, 10)) consecutiveDays++;
    else break;
  }
  return {
    chatCount: persona[0].chatCount,
    totalMessages: msgCount?.c || 0,
    memoryCount: memCount?.c || 0,
    emotionVariety: emotionRows.length,
    daysSinceCreation,
    consecutiveDays,
  };
}

export async function updateIntimacy(personaId: number, userId: number, score: number, level: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(personas).set({ intimacyScore: score, intimacyLevel: level })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
}

// ─── Memory helpers ───────────────────────────────────────────────────────

export async function createMemory(data: InsertMemory) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(memories).values(data).returning({ id: memories.id });
  return result.id;
}

export async function getMemoriesByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  // Pinned first, then by weight, then newest. The retrieval scorer does
  // its own ranking, but a low-weight memory should not be invisible to it
  // just because it is old — the candidate list is capped, so the order
  // decides what gets scored at all.
  return db.select().from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)))
    .orderBy(desc(memories.isPinned), desc(memories.importance), desc(memories.createdAt))
    .limit(200);
}

export async function deleteMemory(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(memories).where(and(eq(memories.id, id), eq(memories.userId, userId)));
}

// ─── Emotion Snapshot helpers ─────────────────────────────────────────────

export async function createEmotionSnapshot(data: InsertEmotionSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(emotionSnapshots).values(data).returning({ id: emotionSnapshots.id });
  return result.id;
}

export async function getEmotionSnapshots(personaId: number, userId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.select().from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.createdAt, since),
    ))
    .orderBy(emotionSnapshots.date);
}

export async function getEmotionReport(personaId: number, userId: number, days = 30) {
  const db = await getDb();
  if (!db) return { snapshots: [], distribution: [], totalDays: 0, totalMessages: 0 };
  const since = new Date();
  since.setDate(since.getDate() - days);
  const snapshots = await db.select().from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.createdAt, since),
    ))
    .orderBy(emotionSnapshots.date);
  const distribution = await db.select({
    emotionalState: emotionSnapshots.emotionalState,
    count: count(),
  }).from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.createdAt, since),
    ))
    .groupBy(emotionSnapshots.emotionalState);
  const totalMessages = snapshots.reduce((sum, s) => sum + s.messageCount, 0);
  return { snapshots, distribution, totalDays: snapshots.length, totalMessages };
}

export async function getTodaySnapshot(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId), eq(emotionSnapshots.date, today)))
    .limit(1);
  return rows[0];
}

// ─── Analytics helpers ────────────────────────────────────────────────────

export async function getMessageVolume(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({ date: sql<string>`DATE(${messages.createdAt})`, count: count() })
    .from(messages).where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`DATE(${messages.createdAt})`).orderBy(sql`DATE(${messages.createdAt})`);
}

export async function getEmotionTimeline(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({
    date: emotionSnapshots.date,
    emotionalState: emotionSnapshots.emotionalState,
    count: count(),
  }).from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.userId, userId), gte(emotionSnapshots.createdAt, since)))
    .groupBy(emotionSnapshots.date, emotionSnapshots.emotionalState)
    .orderBy(emotionSnapshots.date);
}

export async function getPersonaEngagement(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({
    personaId: messages.personaId,
    name: personas.name,
    messageCount: count(),
  }).from(messages)
    .innerJoin(personas, eq(messages.personaId, personas.id))
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(messages.personaId, personas.name)
    .orderBy(desc(count()));
}

export async function getHourlyDistribution(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({
    hour: sql<number>`EXTRACT(HOUR FROM ${messages.createdAt})::int`,
    count: count(),
  }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`EXTRACT(HOUR FROM ${messages.createdAt})`);
}

export async function getAnalyticsStats(userId: number, days: number) {
  const db = await getDb();
  if (!db) return { totalMessages: 0, activeDays: 0, longestStreak: 0, avgPerDay: 0 };
  const since = new Date(); since.setDate(since.getDate() - days);
  const [msgCount] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)));
  const activeDaysRows = await db.select({ d: sql<string>`DATE(${messages.createdAt})` }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`DATE(${messages.createdAt})`).orderBy(sql`DATE(${messages.createdAt})`);
  const activeDays = activeDaysRows.length;
  let longestStreak = 0, currentStreak = 0;
  for (let i = 0; i < activeDaysRows.length; i++) {
    if (i === 0) { currentStreak = 1; }
    else {
      const prev = new Date(activeDaysRows[i - 1].d);
      const curr = new Date(activeDaysRows[i].d);
      const diff = (curr.getTime() - prev.getTime()) / 86400000;
      currentStreak = diff === 1 ? currentStreak + 1 : 1;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
  }
  return { totalMessages: msgCount?.c || 0, activeDays, longestStreak, avgPerDay: activeDays > 0 ? Math.round((msgCount?.c || 0) / activeDays) : 0 };
}

// ─── Diary helpers ────────────────────────────────────────────────────────

export async function createDiaryEntry(data: InsertDiaryEntry) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(diaryEntries).values(data).returning({ id: diaryEntries.id });
  return result.id;
}

export async function getDiaryEntries(userId: number, personaId?: number, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(diaryEntries.userId, userId)];
  if (personaId) conditions.push(eq(diaryEntries.personaId, personaId));
  const rows = await db.select({
    id: diaryEntries.id, personaId: diaryEntries.personaId, date: diaryEntries.date,
    summary: diaryEntries.summary, highlights: diaryEntries.highlights,
    emotionalArc: diaryEntries.emotionalArc, quotes: diaryEntries.quotes,
    reflection: diaryEntries.reflection, messageCount: diaryEntries.messageCount,
    createdAt: diaryEntries.createdAt, personaName: personas.name,
  }).from(diaryEntries)
    .innerJoin(personas, eq(diaryEntries.personaId, personas.id))
    .where(and(...conditions))
    .orderBy(desc(diaryEntries.date))
    .limit(limit);
  return rows;
}

export async function getDiaryByDate(personaId: number, userId: number, date: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId), eq(diaryEntries.date, date)))
    .limit(1);
  return rows[0];
}

export async function deleteDiaryEntry(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(diaryEntries).where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId)));
}

export async function getMessagesByDate(personaId: number, userId: number, date: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), sql`DATE(${messages.createdAt}) = ${date}`))
    .orderBy(asc(messages.createdAt));
}

export async function getDiaryDates(userId: number, personaId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(diaryEntries.userId, userId)];
  if (personaId) conditions.push(eq(diaryEntries.personaId, personaId));
  const rows = await db.select({ date: diaryEntries.date }).from(diaryEntries).where(and(...conditions));
  return rows.map(r => r.date);
}

// ─── SCENES ──────────────────────────────────────────────────────────────────

const BUILTIN_SCENES: InsertScene[] = [
  { name: "一起看电影", icon: "🎬", description: "窝在沙发上一起看电影，分享感受", systemPromptOverlay: "你们正在一起看电影，气氛温馨浪漫。你会评论剧情、分享感受，偶尔靠近对方。", emotionalState: "warm", starters: ["今天想看什么类型的电影？", "我准备好爆米花了~", "上次那部电影你还记得吗？"], isBuiltin: true },
  { name: "深夜聊天", icon: "🌙", description: "夜深人静，说些白天不会说的话", systemPromptOverlay: "现在是深夜，周围很安静。你的语气更加柔软、私密，愿意分享内心深处的想法和感受。", emotionalState: "nostalgic", starters: ["睡不着吗？", "夜深了，在想什么呢...", "这个时间特别想你"], isBuiltin: true },
  { name: "吵架和好", icon: "💔", description: "经历小摩擦后的和解", systemPromptOverlay: "你们之间刚发生了一点小矛盾，你有些委屈但也想和好。语气带着一点赌气但又舍不得真的生气。", emotionalState: "melancholy", starters: ["你还在生气吗...", "我不是故意的", "我们别吵了好不好"], isBuiltin: true },
  { name: "一起旅行", icon: "✈️", description: "想象一起去远方旅行", systemPromptOverlay: "你们正在一起旅行，心情愉快兴奋。你会描述看到的风景、分享旅途趣事，充满期待和快乐。", emotionalState: "happy", starters: ["下一站想去哪里？", "快看那边的风景！", "旅途中最开心的就是有你在身边"], isBuiltin: true },
  { name: "纪念日", icon: "🎂", description: "庆祝你们的特别日子", systemPromptOverlay: "今天是你们的纪念日，你特别开心和感动。你会回忆过去的美好时光，表达珍惜和感恩。", emotionalState: "happy", starters: ["今天是我们的特别日子呢", "还记得我们第一次见面吗？", "谢谢你一直在我身边"], isBuiltin: true },
];

async function seedBuiltinScenes(db: ReturnType<typeof drizzle>) {
  const existing = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.isBuiltin, true)).limit(1);
  if (existing.length > 0) return;
  for (const s of BUILTIN_SCENES) {
    await db.insert(scenes).values(s);
  }
}

export async function getScenes(userId: number) {
  const db = await getDb();
  if (!db) return [];
  await seedBuiltinScenes(db);
  return db.select().from(scenes)
    .where(sql`${scenes.isBuiltin} = true OR ${scenes.userId} = ${userId}`)
    .orderBy(desc(scenes.isBuiltin), asc(scenes.createdAt));
}

/**
 * Reads a scene by id.
 *
 * 与自用版一致：只按 id 读取，不再在数据层按 userId 过滤。
 * 调用方必须自己校验归属——路由层统一按 `isBuiltin || scene.userId === userId`
 * 判断（见 `server/routers.ts` 的 scene.activate / detail / copy / update），
 * `chat/service.ts` 读当前场景时也再兜一次同样的判断，避免历史脏数据把
 * 别人的 systemPromptOverlay 注入本用户对话。
 *
 * 内置场景 userId 为 null，由调用方按 `isBuiltin` 放行。
 */
export async function getSceneById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(scenes).where(eq(scenes.id, id)).limit(1);
  return row || null;
}

/** 去掉首尾空白；空串按 null 存，避免“有覆盖但内容为空”的歧义状态。 */
function normalizedSceneText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export async function createScene(data: InsertScene) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const normalizedData: InsertScene = {
    ...data,
    personaIdentityOverride: normalizedSceneText(data.personaIdentityOverride),
    userIdentityOverride: normalizedSceneText(data.userIdentityOverride),
    scenePersonaRefKey: normalizedSceneText(data.scenePersonaRefKey),
    sceneUserRefKey: normalizedSceneText(data.sceneUserRefKey),
    sceneEnvRefKey: normalizedSceneText(data.sceneEnvRefKey),
    sceneVisualBaseline: normalizedSceneText(data.sceneVisualBaseline),
  };
  const [row] = await db.insert(scenes).values(normalizedData).returning();
  return row;
}

/**
 * Edits a scene.
 *
 * Only the user who created a custom scene may change it: the WHERE clause
 * carries both the owner and `isBuiltin = false`, so a built-in scene can
 * never be rewritten and another user's scene is never touched. Returns
 * null when nothing matched — the caller turns that into a refusal.
 */
export async function updateScene(id: number, userId: number, data: Partial<InsertScene>) {
  const db = await getDb();
  if (!db) return null;
  const normalizedData: Partial<InsertScene> = { ...data };
  if ("personaIdentityOverride" in data) {
    normalizedData.personaIdentityOverride = normalizedSceneText(data.personaIdentityOverride);
  }
  if ("userIdentityOverride" in data) {
    normalizedData.userIdentityOverride = normalizedSceneText(data.userIdentityOverride);
  }
  if ("contextSeed" in data) {
    normalizedData.contextSeed = data.contextSeed?.trim() || null;
  }
  if ("scenePersonaRefKey" in data) {
    normalizedData.scenePersonaRefKey = normalizedSceneText(data.scenePersonaRefKey);
  }
  if ("sceneUserRefKey" in data) {
    normalizedData.sceneUserRefKey = normalizedSceneText(data.sceneUserRefKey);
  }
  if ("sceneEnvRefKey" in data) {
    normalizedData.sceneEnvRefKey = normalizedSceneText(data.sceneEnvRefKey);
  }
  if ("sceneVisualBaseline" in data) {
    normalizedData.sceneVisualBaseline = normalizedSceneText(data.sceneVisualBaseline);
  }
  const [row] = await db.update(scenes)
    .set(normalizedData)
    .where(and(
      eq(scenes.id, id),
      eq(scenes.isBuiltin, false),
      eq(scenes.userId, userId),
    ))
    .returning();
  return row || null;
}

// ─── Scene lifecycle, memory and conversation context ──────────────────────

const personaOwner = (personaId: number, userId: number) =>
  and(eq(personas.id, personaId), eq(personas.userId, userId));
const chatContextOwner = (personaId: number, userId: number) =>
  and(eq(chatContextStates.personaId, personaId), eq(chatContextStates.userId, userId));
const sceneMemoryOwner = (personaId: number, userId: number, sceneId: number) =>
  and(eq(sceneMemoryStates.personaId, personaId), eq(sceneMemoryStates.userId, userId),
    eq(sceneMemoryStates.sceneId, sceneId));
const sceneMessageOwner = (personaId: number, userId: number, sceneId: number) =>
  and(eq(messages.personaId, personaId), eq(messages.userId, userId),
    eq(messages.sceneId, sceneId), eq(messages.mode, "scene"));
const accessibleScene = (sceneId: number, userId: number) =>
  and(eq(scenes.id, sceneId), or(eq(scenes.isBuiltin, true), eq(scenes.userId, userId)));

type SceneConnection = NonNullable<Awaited<ReturnType<typeof getDb>>> | DbTransaction;
type LockedChatContext = typeof chatContextStates.$inferSelect;

/** All context mutations lock this row before any scene, message or memory row. */
export async function lockChatContext(
  tx: DbTransaction, personaId: number, userId: number, lock: "share" | "update" = "update",
): Promise<LockedChatContext> {
  const owner = personaOwner(personaId, userId);
  const scope = chatContextOwner(personaId, userId);
  const [persona] = await tx.select({ id: personas.id }).from(personas).where(owner).limit(1);
  if (!persona) throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在。" });
  const read = () => tx.select().from(chatContextStates).where(scope).limit(1).for(lock);
  const [existing] = await read();
  if (existing) return existing;
  await tx.insert(chatContextStates).values({ personaId, userId }).onConflictDoNothing();
  const [created] = await read();
  if (!created) throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在。" });
  return created;
}

async function advanceContextRevision(tx: DbTransaction, context: LockedChatContext) {
  const revision = context.revision + 1;
  await tx.update(chatContextStates).set({ revision, updatedAt: new Date() })
    .where(eq(chatContextStates.id, context.id));
  return revision;
}

/** Review accepts lock the persona before evidence messages; bulk edits use the same order. */
export async function lockPersonaForSceneMessageChanges(tx: DbTransaction, personaId: number, userId: number) {
  const [persona] = await tx.select({ id: personas.id }).from(personas)
    .where(personaOwner(personaId, userId)).limit(1).for("no key update");
  if (!persona) throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在。" });
}

/** Call after locking the persona's context. The scene cannot disappear before commit. */
export async function lockSceneForContext(tx: DbTransaction, userId: number, sceneId: number) {
  const [scene] = await tx.select().from(scenes).where(accessibleScene(sceneId, userId))
    .limit(1).for("share");
  return scene ?? null;
}

async function requireSceneForContext(tx: DbTransaction, userId: number, sceneId: number) {
  const scene = await lockSceneForContext(tx, userId, sceneId);
  if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "场景不存在。" });
  return scene;
}

/** Only activation and deletion take this lock, before either touches context rows. */
async function lockSceneLifecycle(tx: DbTransaction, userId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ink-and-kin:scene-lifecycle'), ${userId})`);
}

export async function deleteScene(id: number, userId: number): Promise<boolean> {
  return withTransaction(async tx => {
    await lockSceneLifecycle(tx, userId);
    const owned = and(eq(scenes.id, id), eq(scenes.isBuiltin, false), eq(scenes.userId, userId));
    const [existing] = await tx.select({ id: scenes.id }).from(scenes).where(owned).limit(1);
    if (!existing) return false;

    const attached = await tx.select({ id: personas.id }).from(personas)
      .where(and(eq(personas.userId, userId), eq(personas.activeSceneId, id)))
      .orderBy(asc(personas.id));
    const contexts = [];
    for (const { id: personaId } of attached) contexts.push(await lockChatContext(tx, personaId, userId));

    // Scene deletion cascades into review candidates, including those of inactive personas.
    // Drain their review transactions before locking the scene or the candidate cascade can deadlock.
    await tx.select({ id: personas.id }).from(personas).where(eq(personas.userId, userId))
      .orderBy(asc(personas.id)).for("no key update");
    const [scene] = await tx.select({ id: scenes.id }).from(scenes).where(owned).limit(1).for("update");
    if (!scene) return false;
    for (const context of contexts) await advanceContextRevision(tx, context);
    await tx.update(personas).set({ activeSceneId: null, updatedAt: new Date() })
      .where(and(eq(personas.userId, userId), eq(personas.activeSceneId, id)));
    await tx.delete(scenes).where(owned); // The foreign key also removes all scene memory states.
    return true;
  });
}

export async function activateScene(personaId: number, sceneId: number | null, userId: number) {
  await withTransaction(async tx => {
    await lockSceneLifecycle(tx, userId);
    const context = await lockChatContext(tx, personaId, userId);
    await lockPersonaForSceneMessageChanges(tx, personaId, userId);
    const scene = sceneId === null ? null : await requireSceneForContext(tx, userId, sceneId);
    if (scene?.continuationEnabled === false) {
      await advanceSceneBoundary(tx, personaId, userId, scene.id, false);
    }
    await tx.update(personas).set({ activeSceneId: sceneId, updatedAt: new Date() })
      .where(personaOwner(personaId, userId));
    await advanceContextRevision(tx, context);
  });
}

/** Binds the current scene and revision in one short transaction before generation. */
export async function getSceneGenerationSnapshot(
  personaId: number, userId: number, options: { startNewScene?: boolean; expectedRevision?: number } = {},
) {
  return withTransaction(async tx => {
    const context = await lockChatContext(tx, personaId, userId, options.startNewScene ? "update" : "share");
    if (options.expectedRevision !== undefined && context.revision !== options.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "对话上下文已变化，请重新发送。" });
    const [persona] = await tx.select().from(personas).where(personaOwner(personaId, userId)).limit(1);
    if (!persona) throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在。" });
    if (options.startNewScene && persona.activeSceneId != null) {
      await lockPersonaForSceneMessageChanges(tx, personaId, userId);
    }
    const scene = persona.activeSceneId == null ? null : await lockSceneForContext(tx, userId, persona.activeSceneId);
    let revision = context.revision;
    if (scene && options.startNewScene) {
      await advanceSceneBoundary(tx, personaId, userId, scene.id, true);
      revision = await advanceContextRevision(tx, context);
    }
    return { persona, scene, revision };
  });
}

export type SceneMemoryStateSnapshot = {
  stateId?: number | null;
  storyState: SceneMemoryStoryState | null;
  cache: SceneMemoryCache | null;
};

async function readSceneMemoryRow(
  connection: SceneConnection, personaId: number, userId: number, sceneId: number,
) {
  const [row] = await connection.select().from(sceneMemoryStates)
    .where(sceneMemoryOwner(personaId, userId, sceneId)).limit(1);
  return row;
}

function sceneSnapshot(row: Awaited<ReturnType<typeof readSceneMemoryRow>> | undefined): SceneMemoryStateSnapshot {
  return {
    stateId: row?.id ?? null,
    storyState: normalizeSceneMemoryStoryState(row?.storyState),
    cache: normalizeSceneMemoryCache(row?.cache),
  };
}

async function sceneAssistantMessageCount(
  connection: SceneConnection, personaId: number, userId: number, sceneId: number, boundary: number,
) {
  const [row] = await connection.select({ count: count() }).from(messages)
    .where(and(sceneMessageOwner(personaId, userId, sceneId), eq(messages.role, "assistant"),
      gt(messages.id, boundary), sql`${messages.contextOverride} IS DISTINCT FROM false`));
  return Number(row?.count ?? 0);
}

/** Daily history keeps its own boundary; scene reads never fall back to it. */
export async function getPersonaConversationContextStartMessageId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const [state] = await db.select({ boundary: chatContextStates.startAfterMessageId })
    .from(chatContextStates).where(chatContextOwner(personaId, userId)).limit(1);
  return state?.boundary ?? 0;
}

export async function countSceneAssistantMessages(personaId: number, userId: number, sceneId: number) {
  const db = await getDb();
  if (!db) return 0;
  const row = await readSceneMemoryRow(db, personaId, userId, sceneId);
  return sceneAssistantMessageCount(db, personaId, userId, sceneId, row?.startAfterMessageId ?? 0);
}

export async function getSceneMemoryStateSnapshot(
  personaId: number, userId: number, sceneId: number,
): Promise<SceneMemoryStateSnapshot> {
  const db = await getDb();
  const row = db ? await readSceneMemoryRow(db, personaId, userId, sceneId) : undefined;
  const snapshot = sceneSnapshot(row);
  if (db && row && snapshot.storyState) {
    snapshot.storyState.turn = await sceneAssistantMessageCount(db, personaId, userId, sceneId, row.startAfterMessageId);
  }
  return snapshot;
}

type SceneMemoryPatch = {
  storyState?: SceneMemoryStoryState | null;
  cache?: SceneMemoryCache | null;
};

async function writeSceneMemoryState(
  tx: DbTransaction, personaId: number, userId: number, sceneId: number,
  existing: Awaited<ReturnType<typeof readSceneMemoryRow>> | undefined,
  patch: SceneMemoryPatch,
): Promise<SceneMemoryStateSnapshot> {
  const storyState = normalizeSceneMemoryStoryState(
    patch.storyState === undefined ? existing?.storyState : patch.storyState,
  ) ?? buildInitialSceneMemoryStoryState("scene:" + sceneId);
  const cache = normalizeSceneMemoryCache(patch.cache === undefined ? existing?.cache : patch.cache)
    ?? buildInitialSceneMemoryCache();
  if (existing) {
    await tx.update(sceneMemoryStates).set({ storyState, cache, updatedAt: new Date() })
      .where(eq(sceneMemoryStates.id, existing.id));
    return { stateId: existing.id, storyState, cache };
  }
  const [created] = await tx.insert(sceneMemoryStates).values({ personaId, userId, sceneId, storyState, cache })
    .returning({ id: sceneMemoryStates.id });
  return { stateId: created.id, storyState, cache };
}

export async function upsertSceneMemoryState(
  personaId: number, userId: number, sceneId: number, data: SceneMemoryPatch,
): Promise<void> {
  await mutateSceneMemoryState(personaId, userId, sceneId, () => data);
}

/** The model runs outside the transaction; delayed results need the original revision and row ID. */
export async function mutateSceneMemoryState(
  personaId: number, userId: number, sceneId: number,
  mutate: (current: SceneMemoryStateSnapshot) => SceneMemoryPatch | null,
  expected?: number | { stateId: number; revision: number },
): Promise<SceneMemoryStateSnapshot | null> {
  return withTransaction(async tx => {
    const context = await lockChatContext(tx, personaId, userId);
    if (typeof expected === "object" && context.revision !== expected.revision) return null;
    const scene = await lockSceneForContext(tx, userId, sceneId);
    if (!scene) {
      if (expected !== undefined) return null;
      throw new TRPCError({ code: "NOT_FOUND", message: "场景不存在。" });
    }
    const existing = await readSceneMemoryRow(tx, personaId, userId, sceneId);
    const expectedId = typeof expected === "object" ? expected.stateId : expected;
    if (expectedId !== undefined && existing?.id !== expectedId) return null;
    const current = sceneSnapshot(existing);
    const patch = mutate(current);
    if (patch === null) return current;
    const snapshot = await writeSceneMemoryState(tx, personaId, userId, sceneId, existing, patch);
    if (expected === undefined) await advanceContextRevision(tx, context);
    return snapshot;
  });
}

/** Call under the context and scene locks, after any message mutations. */
async function replaceSceneMemoryState(
  tx: DbTransaction, personaId: number, userId: number, sceneId: number,
  options: { boundary?: number; preserveManualFacts: boolean; resetStory: boolean },
) {
  const existing = await readSceneMemoryRow(tx, personaId, userId, sceneId);
  const boundary = options.boundary ?? existing?.startAfterMessageId ?? 0;
  const snapshot = sceneSnapshot(existing);
  const facts = options.preserveManualFacts
    ? (snapshot.cache?.pinnedFacts ?? []).filter(fact => fact.source === "user") : [];
  const storyState = options.resetStory || !snapshot.storyState
    ? buildInitialSceneMemoryStoryState("scene:" + sceneId) : {
      ...snapshot.storyState,
      turn: await sceneAssistantMessageCount(tx, personaId, userId, sceneId, boundary),
      lastMessageId: null,
      updatedAt: new Date().toISOString(),
    };
  // Replacing the row also invalidates refreshes that started before this change.
  if (existing) await tx.delete(sceneMemoryStates).where(eq(sceneMemoryStates.id, existing.id));
  await tx.insert(sceneMemoryStates).values({
    personaId, userId, sceneId, startAfterMessageId: boundary, storyState,
    cache: { ...buildInitialSceneMemoryCache(), pinnedFacts: facts },
  });
}

async function advanceSceneBoundary(
  tx: DbTransaction, personaId: number, userId: number, sceneId: number, preserveManualFacts: boolean,
) {
  const scope = sceneMessageOwner(personaId, userId, sceneId);
  const [latest] = await tx.select({ id: messages.id }).from(messages).where(scope)
    .orderBy(desc(messages.id)).limit(1);
  const boundary = Math.max(latest?.id ?? 0,
    (await readSceneMemoryRow(tx, personaId, userId, sceneId))?.startAfterMessageId ?? 0);
  await tx.update(messages).set({ contextOverride: null }).where(and(scope,
    lte(messages.id, boundary), sql`${messages.contextOverride} IS NOT NULL`));
  await replaceSceneMemoryState(tx, personaId, userId, sceneId, {
    boundary, preserveManualFacts, resetStory: true,
  });
  return boundary;
}

export async function clearSceneMemoryState(personaId: number, userId: number, sceneId: number): Promise<void> {
  await withTransaction(async tx => {
    const context = await lockChatContext(tx, personaId, userId);
    await lockPersonaForSceneMessageChanges(tx, personaId, userId);
    await requireSceneForContext(tx, userId, sceneId);
    await advanceSceneBoundary(tx, personaId, userId, sceneId, false);
    await advanceContextRevision(tx, context);
  });
}

/** Invalidate after a deletion in the transaction that locked context and scene first. */
export async function invalidateSceneMessageContext(
  tx: DbTransaction, context: LockedChatContext, sceneId: number,
): Promise<void> {
  await replaceSceneMemoryState(tx, context.personaId, context.userId, sceneId, {
    preserveManualFacts: true, resetStory: false,
  });
  await advanceContextRevision(tx, context);
}

/** A reply's message and turn can be committed together using the caller's locked transaction. */
export async function recordSceneMemoryTurn(
  personaId: number, userId: number, sceneId: number, sceneKey: string, messageIds: number[],
  tx?: DbTransaction,
): Promise<number> {
  const record = async (transaction: DbTransaction) => {
    const existing = await readSceneMemoryRow(transaction, personaId, userId, sceneId);
    const previous = sceneSnapshot(existing);
    const now = new Date().toISOString();
    const turn = await sceneAssistantMessageCount(transaction, personaId, userId, sceneId, existing?.startAfterMessageId ?? 0);
    const ids = messageIds.filter(id => Number.isSafeInteger(id) && id > 0);
    await writeSceneMemoryState(transaction, personaId, userId, sceneId, existing, {
      storyState: {
        sceneKey: sceneKey || previous.storyState?.sceneKey || "scene:" + sceneId,
        turn,
        startedAt: previous.storyState?.startedAt || now,
        updatedAt: now,
        lastMessageId: ids.at(-1) ?? previous.storyState?.lastMessageId ?? null,
        lastExitAt: previous.storyState?.lastExitAt ?? null,
      },
      cache: appendSceneMemoryRecentMessages(previous.cache ?? buildInitialSceneMemoryCache(now), ids, now),
    });
    return turn;
  };
  if (tx) return record(tx); // Caller already holds the exclusive context lock and the scene lock.
  return withTransaction(async transaction => {
    await lockChatContext(transaction, personaId, userId);
    await requireSceneForContext(transaction, userId, sceneId);
    return record(transaction);
  });
}

export async function startNewPersonaConversationContext(personaId: number, userId: number) {
  const result = await startNewActiveConversationContext(personaId, userId);
  return result.startAfterMessageId;
}

/** The chat menu starts a new segment in the mode that is active under the context lock. */
export async function startNewActiveConversationContext(personaId: number, userId: number) {
  return withTransaction(async tx => {
    const context = await lockChatContext(tx, personaId, userId);
    const [persona] = await tx.select({ activeSceneId: personas.activeSceneId }).from(personas)
      .where(personaOwner(personaId, userId)).limit(1);
    if (!persona) throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在。" });
    if (persona.activeSceneId !== null) {
      await lockPersonaForSceneMessageChanges(tx, personaId, userId);
      const scene = await lockSceneForContext(tx, userId, persona.activeSceneId);
      if (scene) {
        const startAfterMessageId = await advanceSceneBoundary(tx, personaId, userId, scene.id, true);
        const revision = await advanceContextRevision(tx, context);
        return { startAfterMessageId, revision };
      }
    }
    const [latest] = await tx.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), eq(messages.mode, "daily")))
      .orderBy(desc(messages.id)).limit(1);
    const startAfterMessageId = Math.max(context.startAfterMessageId, latest?.id ?? 0);
    const revision = context.revision + 1;
    await tx.update(chatContextStates).set({ startAfterMessageId, revision, overrides: {}, updatedAt: new Date() })
      .where(eq(chatContextStates.id, context.id));
    await tx.delete(chatSummaries).where(and(eq(chatSummaries.personaId, personaId), eq(chatSummaries.userId, userId)));
    return { startAfterMessageId, revision };
  });
}

export function isMessageIncludedInContext(
  messageId: number, contextOverride: boolean | null, startAfterMessageId: number,
): boolean {
  return contextOverride ?? messageId > startAfterMessageId;
}

async function readSceneMessages(
  connection: SceneConnection, personaId: number, userId: number, sceneId: number,
  boundary: number, limit: number,
) {
  const rows = await connection.select().from(messages)
    .where(and(sceneMessageOwner(personaId, userId, sceneId),
      or(eq(messages.contextOverride, true), and(isNull(messages.contextOverride), gt(messages.id, boundary)))))
    .orderBy(desc(sql`COALESCE(${messages.contextOverride}, false)`), desc(messages.createdAt), desc(messages.id))
    .limit(Math.max(1, Math.trunc(limit)));
  return rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id - right.id)
    .map(message => message.messageType === "image" && message.role === "assistant"
      ? { ...message, content: "[图片]" } : message);
}

/** Captures the exact message window, scene and both write guards before the model is called. */
export async function getSceneMemoryRefreshSnapshot(
  personaId: number, userId: number, sceneId: number, limit = 24, expectedRevision?: number,
) {
  return withTransaction(async tx => {
    const context = await lockChatContext(tx, personaId, userId);
    if (expectedRevision !== undefined && expectedRevision !== context.revision) return null;
    const scene = await lockSceneForContext(tx, userId, sceneId);
    if (!scene) return null;
    const row = await readSceneMemoryRow(tx, personaId, userId, sceneId);
    const history = await readSceneMessages(tx, personaId, userId, sceneId, row?.startAfterMessageId ?? 0, limit);
    if (!history.length) return null;
    const snapshot = row ? sceneSnapshot(row) : await writeSceneMemoryState(tx, personaId, userId, sceneId, row, {});
    if (snapshot.stateId == null) return null;
    return { scene, history, cache: snapshot.cache, revision: context.revision, stateId: snapshot.stateId };
  });
}

export async function getSceneConversationMessagesBySceneId(
  personaId: number, userId: number, sceneId: number, limit = 50,
) {
  const db = await getDb();
  if (!db) return [];
  const row = await readSceneMemoryRow(db, personaId, userId, sceneId);
  return readSceneMessages(db, personaId, userId, sceneId, row?.startAfterMessageId ?? 0, limit);
}

export async function getSceneMessagesForImageContext(
  personaId: number, userId: number, sceneId: number, limit = 10,
) {
  return getSceneConversationMessagesBySceneId(personaId, userId, sceneId,
    Math.max(1, Math.min(20, Math.trunc(limit))));
}

export async function getSceneMessageContextManagement(
  personaId: number, userId: number, sceneId: number, limit = 300,
) {
  const db = await getDb();
  if (!db) return { startAfterMessageId: 0, messages: [] };
  return db.transaction(async tx => {
    await lockChatContext(tx, personaId, userId, "share");
    await requireSceneForContext(tx, userId, sceneId);
    const row = await readSceneMemoryRow(tx, personaId, userId, sceneId);
    const startAfterMessageId = row?.startAfterMessageId ?? 0;
    const rows = await tx.select().from(messages).where(sceneMessageOwner(personaId, userId, sceneId))
      .orderBy(desc(messages.createdAt), desc(messages.id)).limit(Math.max(1, Math.min(500, Math.trunc(limit))));
    return {
      startAfterMessageId,
      messages: rows.reverse().map(message => ({
        ...message,
        content: message.messageType === "image" && message.role === "assistant" ? "[图片]" : message.content,
        effectiveInContext: isMessageIncludedInContext(message.id, message.contextOverride, startAfterMessageId),
      })),
    };
  });
}

async function changeSceneMessageOverrides(
  personaId: number, userId: number, sceneId: number, included: boolean | null, ids?: number[],
): Promise<number> {
  return withTransaction(async tx => {
    const context = await lockChatContext(tx, personaId, userId);
    await lockPersonaForSceneMessageChanges(tx, personaId, userId);
    await requireSceneForContext(tx, userId, sceneId);
    const updated = await tx.update(messages).set({ contextOverride: included })
      .where(and(sceneMessageOwner(personaId, userId, sceneId),
        ids ? inArray(messages.id, ids) : undefined,
        sql`${messages.contextOverride} IS DISTINCT FROM ${included}`))
      .returning({ id: messages.id });
    if (updated.length) await invalidateSceneMessageContext(tx, context, sceneId);
    return updated.length;
  });
}

export async function setSceneMessagesContextOverride(
  personaId: number, userId: number, sceneId: number, messageIds: number[], included: boolean | null,
): Promise<number> {
  const ids = Array.from(new Set(messageIds.filter(id => Number.isSafeInteger(id) && id > 0)));
  return ids.length ? changeSceneMessageOverrides(personaId, userId, sceneId, included, ids) : 0;
}

export async function clearSceneMessagesContextOverride(personaId: number, userId: number, sceneId: number) {
  await changeSceneMessageOverrides(personaId, userId, sceneId, null);
}

export async function setAllSceneMessagesContextOverride(
  personaId: number, userId: number, sceneId: number, included: boolean | null,
): Promise<number> {
  return changeSceneMessageOverrides(personaId, userId, sceneId, included);
}

// ─── Export helpers ─────────────────────────────────────────────────────────

export async function getExportData(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [persona] = await db.select().from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  if (!persona) return null;
  const allMessages = await db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(asc(messages.createdAt));
  const allMemories = await db.select().from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)))
    .orderBy(asc(memories.createdAt));
  const allSnapshots = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId)))
    .orderBy(asc(emotionSnapshots.date));
  const allDiaries = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId)))
    .orderBy(asc(diaryEntries.date));
  return { persona, messages: allMessages, memories: allMemories, emotionSnapshots: allSnapshots, diaryEntries: allDiaries };
}

// ─── Graduation helpers ─────────────────────────────────────────────────────

export async function getRecentEmotionTrend(personaId: number, userId: number, days: number = 14) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.select({ emotionalState: emotionSnapshots.emotionalState })
    .from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.createdAt, since),
    ));
}

export async function getMessageCountInRange(
  personaId: number,
  userId: number,
  startDaysAgo: number,
  endDaysAgo: number,
) {
  const db = await getDb();
  if (!db) return 0;
  const start = new Date(); start.setDate(start.getDate() - startDaysAgo);
  const end = new Date(); end.setDate(end.getDate() - endDaysAgo);
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.createdAt, start),
      sql`${messages.createdAt} < ${end}`
    ));
  return result?.c || 0;
}

export async function setGraduationStatus(
  personaId: number, userId: number,
  status: "suggested" | "graduated" | "declined" | null,
  farewellLetter?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const data: Record<string, any> = { graduationStatus: status, updatedAt: new Date() };
  if (status === "graduated") {
    data.graduatedAt = new Date();
    if (farewellLetter) data.farewellLetter = farewellLetter;
  }
  if (status === null) {
    data.graduatedAt = null;
    data.farewellLetter = null;
    data.graduationStatus = null;
  }
  await db.update(personas).set(data)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
}

// ─── Conversation summary helpers ──────────────────────────────────────────

export async function createChatSummary(data: InsertChatSummary, tx?: DbTransaction) {
  const db = tx ?? await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(chatSummaries).values(data).returning({ id: chatSummaries.id });
  return result.id;
}

export async function getLatestChatSummary(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(chatSummaries)
    .where(and(eq(chatSummaries.personaId, personaId), eq(chatSummaries.userId, userId)))
    .orderBy(desc(chatSummaries.createdAt)).limit(1);
  return rows[0];
}

export async function getChatSummaries(personaId: number, userId: number, limit = 3) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatSummaries)
    .where(and(eq(chatSummaries.personaId, personaId), eq(chatSummaries.userId, userId)))
    .orderBy(desc(chatSummaries.createdAt)).limit(limit);
}

// ─── Safety event helpers ──────────────────────────────────────────────────

export async function createSafetyEvent(data: InsertSafetyEvent) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(safetyEvents).values(data).returning({ id: safetyEvents.id });
  return result.id;
}

export async function getSafetyEvents(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(safetyEvents)
    .where(eq(safetyEvents.userId, userId))
    .orderBy(desc(safetyEvents.createdAt)).limit(limit);
}

export async function resolveSafetyEvent(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(safetyEvents).set({ resolvedAt: new Date(), handled: true })
    .where(and(eq(safetyEvents.id, id), eq(safetyEvents.userId, userId)));
}

// ─── Graduation trajectory helpers ─────────────────────────────────────────

export async function createGraduationAssessment(data: InsertGraduationAssessment) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(graduationAssessments).values(data)
    .returning({ id: graduationAssessments.id });
  return result.id;
}

export async function getLatestGraduationAssessment(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(graduationAssessments)
    .where(and(
      eq(graduationAssessments.personaId, personaId),
      eq(graduationAssessments.userId, userId),
    ))
    .orderBy(desc(graduationAssessments.createdAt)).limit(1);
  return rows[0];
}

// ─── Channel helpers ───────────────────────────────────────────────────────

export async function createChannelBinding(data: InsertChannelBinding) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(channelBindings).values(data).returning({ id: channelBindings.id });
  return result.id;
}

export async function getChannelBindingsByUserId(userId: number, channel?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(channelBindings.userId, userId)];
  if (channel) conditions.push(eq(channelBindings.channel, channel));
  return db.select().from(channelBindings).where(and(...conditions));
}

/** The default persona bound to a conversation on a channel. */
export async function getChannelBinding(
  userId: number,
  channel: string,
  targetId: string,
) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(channelBindings).where(and(
    eq(channelBindings.userId, userId),
    eq(channelBindings.channel, channel),
    eq(channelBindings.targetId, targetId),
    eq(channelBindings.isActive, true),
  )).limit(1);
  return rows[0];
}

/**
 * Sets the default persona for a conversation on a channel.
 *
 * Replaces any existing active binding for the same conversation.
 */
export async function setChannelBindingPersona(params: {
  userId: number;
  channel: string;
  targetId: string;
  personaId: number;
  targetName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const existing = await db.select().from(channelBindings).where(and(
    eq(channelBindings.userId, params.userId),
    eq(channelBindings.channel, params.channel),
    eq(channelBindings.targetId, params.targetId),
  )).limit(1);

  if (existing[0]) {
    await db.update(channelBindings).set({
      personaId: params.personaId,
      isActive: true,
      ...(params.targetName != null ? { targetName: params.targetName } : {}),
    }).where(eq(channelBindings.id, existing[0].id));
    return existing[0].id;
  }

  const [result] = await db.insert(channelBindings).values({
    userId: params.userId,
    channel: params.channel,
    targetId: params.targetId,
    targetName: params.targetName ?? null,
    personaId: params.personaId,
    isActive: true,
  }).returning({ id: channelBindings.id });
  return result.id;
}

export async function deleteChannelBinding(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(channelBindings)
    .where(and(eq(channelBindings.id, id), eq(channelBindings.userId, userId)));
}

export async function getChannelState(userId: number, channel: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(channelStates).where(and(
    eq(channelStates.userId, userId),
    eq(channelStates.channel, channel),
  )).limit(1);
  return rows[0];
}

export type ChannelStateUpdate = Partial<{
  status: string;
  credentialsEnc: string | null;
  cursor: string | null;
  lastInboundAt: Date | null;
  lastError: string | null;
}>;

export async function upsertChannelState(
  userId: number,
  channel: string,
  data: ChannelStateUpdate,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(channelStates).where(and(
    eq(channelStates.userId, userId),
    eq(channelStates.channel, channel),
  )).limit(1);

  if (existing[0]) {
    await db.update(channelStates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(channelStates.id, existing[0].id));
    return existing[0].id;
  }

  const [result] = await db.insert(channelStates)
    .values({ userId, channel, ...data })
    .returning({ id: channelStates.id });
  return result.id;
}

/** Lists the users that have state for a channel, used to restore on boot. */
export async function getChannelStateUsers(channel: string): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ userId: channelStates.userId })
    .from(channelStates)
    .where(eq(channelStates.channel, channel));
  return Array.from(new Set(rows.map((r) => r.userId)));
}

// ─── Persona template helpers ──────────────────────────────────────────────

export async function getUserTemplates(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personaTemplates)
    .where(eq(personaTemplates.userId, userId))
    .orderBy(desc(personaTemplates.createdAt));
}

export async function createUserTemplate(data: InsertPersonaTemplate) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaTemplates).values(data)
    .returning({ id: personaTemplates.id });
  return result.id;
}

export async function updateUserTemplate(
  id: number,
  userId: number,
  data: Partial<InsertPersonaTemplate>,
) {
  const db = await getDb();
  if (!db) return;
  await db.update(personaTemplates).set(data)
    .where(and(eq(personaTemplates.id, id), eq(personaTemplates.userId, userId)));
}

export async function deleteUserTemplate(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(personaTemplates)
    .where(and(eq(personaTemplates.id, id), eq(personaTemplates.userId, userId)));
}

// ─── Questionnaire helpers ─────────────────────────────────────────────────

export async function createQuestionnaireAnswers(data: InsertPersonaQuestionnaireAnswer) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaQuestionnaireAnswers).values(data)
    .returning({ id: personaQuestionnaireAnswers.id });
  return result.id;
}

export async function getQuestionnaireAnswers(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personaQuestionnaireAnswers)
    .where(and(
      eq(personaQuestionnaireAnswers.personaId, personaId),
      eq(personaQuestionnaireAnswers.userId, userId),
    ))
    .orderBy(desc(personaQuestionnaireAnswers.createdAt));
}

/**
 * Appends a correction entry to a persona's log.
 *
 * The log is an array, so the append happens in application code rather than
 * with a SQL expression — the read and the write are close enough together
 * that a lost update is not worth optimising for.
 */
export async function appendPersonaCorrection(
  personaId: number,
  userId: number,
  entry: Record<string, unknown>,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.select({ log: personas.correctionLog }).from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  const existing = Array.isArray(row?.log) ? (row.log as Record<string, unknown>[]) : [];
  const next = [...existing, entry];
  await db.update(personas).set({ correctionLog: next })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  return next;
}

// ─── Research profile helpers ──────────────────────────────────────────────

/**
 * Stores the artefacts of the celebrity research flow.
 */
export async function createResearchProfile(data: InsertResearchProfile) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(researchProfiles).values(data)
    .returning({ id: researchProfiles.id });
  return result.id;
}

/** Updates the research artefacts of an existing row. */
export async function updateResearchProfile(
  id: number,
  userId: number,
  data: Partial<InsertResearchProfile>,
) {
  const db = await getDb();
  if (!db) return;
  await db.update(researchProfiles).set(data)
    .where(and(eq(researchProfiles.id, id), eq(researchProfiles.userId, userId)));
}

/** The research artefacts of a persona, newest first. */
export async function getResearchProfilesByPersonaId(
  personaId: number,
  userId: number,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(researchProfiles)
    .where(and(eq(researchProfiles.personaId, personaId), eq(researchProfiles.userId, userId)))
    .orderBy(desc(researchProfiles.createdAt));
}

// ─── Collected message helpers ────────────────────────────────────────────

export async function createCollectedMessage(data: InsertCollectedMessage) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(collectedMessages).values(data)
    .returning({ id: collectedMessages.id });
  return result.id;
}

/**
 * The messages already collected for a persona from a source.
 *
 * Used to make an import idempotent: re-running a collection must not
 * duplicate the messages.
 */
export async function getCollectedMessages(
  personaId: number,
  userId: number,
  source: string,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collectedMessages).where(and(
    eq(collectedMessages.personaId, personaId),
    eq(collectedMessages.userId, userId),
    eq(collectedMessages.source, source),
  ));
}

/**
 * Every collected message of a persona, across all sources.
 *
 * The distillation pipeline reads the whole history, not one source at a
 * time.
 */
export async function getCollectedMessagesForPersona(
  personaId: number,
  userId: number,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collectedMessages).where(and(
    eq(collectedMessages.personaId, personaId),
    eq(collectedMessages.userId, userId),
  )).orderBy(asc(collectedMessages.createdAt));
}

// ─── Collection source helpers ────────────────────────────────────────────

export async function getCollectionSources(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collectionSources)
    .where(eq(collectionSources.userId, userId))
    .orderBy(desc(collectionSources.createdAt));
}

export async function upsertCollectionSource(data: InsertCollectionSource) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(collectionSources).values(data)
    .returning({ id: collectionSources.id });
  return result.id;
}

// ─── Collection job helpers ───────────────────────────────────────────────

export async function createCollectionJob(data: InsertCollectionJob) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(collectionJobs).values(data)
    .returning({ id: collectionJobs.id });
  return result.id;
}

export async function updateCollectionJob(
  id: number,
  userId: number,
  data: Partial<InsertCollectionJob>,
) {
  const db = await getDb();
  if (!db) return;
  await db.update(collectionJobs).set(data)
    .where(and(eq(collectionJobs.id, id), eq(collectionJobs.userId, userId)));
}

/** Looks a collection job up by its stable key, for one user. */
export async function getCollectionJobByKey(jobKey: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(collectionJobs)
    .where(and(eq(collectionJobs.jobKey, jobKey), eq(collectionJobs.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function getCollectionJobs(userId?: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  const query = db.select().from(collectionJobs);
  const rows = userId !== undefined
    ? await query.where(eq(collectionJobs.userId, userId))
        .orderBy(desc(collectionJobs.createdAt)).limit(limit)
    : await query.orderBy(desc(collectionJobs.createdAt)).limit(limit);
  return rows;
}

// ─── Reminder helpers ──────────────────────────────────────────────────────

/** Personas that may receive proactive reminders. */
export async function getAllPersonasForReminders() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: personas.id,
    userId: personas.userId,
    name: personas.name,
    togetherFrom: personas.togetherFrom,
    remindersEnabled: personas.remindersEnabled,
  }).from(personas).where(eq(personas.remindersEnabled, true));
}

/**
 * Records a reminder.
 *
 * The unique index on (userId, dedupeKey) is what makes a reminder
 * idempotent: a second attempt to deliver the same reminder is ignored.
 */
export async function recordReminder(data: {
  userId: number;
  personaId: number;
  channel: string;
  kind: string;
  text?: string;
  dedupeKey: string;
  scheduledFor: Date;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const inserted = await db.insert(reminderDeliveries)
    .values({ ...data, deliveredAt: new Date() })
    .onConflictDoNothing();
  return (inserted.rowCount ?? 0) > 0;
}

/** Whether a reminder with this dedupe key has already been delivered. */
export async function hasReminderDelivery(userId: number, dedupeKey: string) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: reminderDeliveries.id })
    .from(reminderDeliveries)
    .where(and(
      eq(reminderDeliveries.userId, userId),
      eq(reminderDeliveries.dedupeKey, dedupeKey),
    ))
    .limit(1);
  return rows.length > 0;
}

/** Reminders that were delivered and have not been dismissed. */
export async function getActiveReminders(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reminderDeliveries)
    .where(and(
      eq(reminderDeliveries.userId, userId),
      sql`${reminderDeliveries.dismissedAt} IS NULL`,
    ))
    .orderBy(desc(reminderDeliveries.deliveredAt)).limit(limit);
}

export async function dismissReminder(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(reminderDeliveries).set({ dismissedAt: new Date() })
    .where(and(eq(reminderDeliveries.id, id), eq(reminderDeliveries.userId, userId)));
}

// ─── Memory recall helpers ─────────────────────────────────────────────────

/** Records that a memory was surfaced, so repeats can be damped. */
export async function touchMemoryRecalled(id: number, userId: number, at: Date) {
  const db = await getDb();
  if (!db) return;
  await db.update(memories).set({ lastRecalledAt: at })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
}

// ─── Message window helpers ────────────────────────────────────────────────

/** Messages for a persona within a time window, oldest first. */
export async function getMessagesSince(personaId: number, userId: number, since: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: messages.id,
    role: messages.role,
    content: messages.content,
    createdAt: messages.createdAt,
  }).from(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.createdAt, since),
    ))
    .orderBy(asc(messages.createdAt));
}

/** The timestamp of the most recent message, used for session-duration checks. */
export async function getLastMessageAt(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({ createdAt: messages.createdAt }).from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt)).limit(1);
  return rows[0]?.createdAt;
}

/** Counts a user's messages since a point in time. */
export async function getMessageCountSince(userId: number, since: Date) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)));
  return result?.c || 0;
}

// ─── Roleplay channel helpers ───────────────────────────────────────────────

/**
 * 频道列表/详情里的成员视图：人物资料直接 join 出来，避免前端再查一次。
 */
export type RoleplayChannelMemberView = {
  id: number;
  channelId: number;
  personaId: number;
  displayOrder: number;
  speakingEnabled: boolean;
  lastReadMessageId: number;
  personaName: string;
  avatarUrl: string | null;
  emotionalState: string;
  analysisStatus: string;
};

/**
 * 频道视图：频道主体字段 + 成员列表。
 *
 * 所有读取都带 userId，跨用户读别人的频道只会得到 undefined/空列表；
 * 路由层再把 undefined 统一翻译成 NOT_FOUND。
 */
export type RoleplayChannelView = {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  scenePrompt: string | null;
  isActive: boolean;
  /** channel=角色生活频道；duet=对戏专用频道。 */
  channelKind: string;
  runtimeDiagnostics: unknown | null;
  /** 剧本导演线（arc），生成侧解析；没有时为空。 */
  directorState: unknown | null;
  generationRevision: number;
  createdAt: Date;
  updatedAt: Date;
  members: RoleplayChannelMemberView[];
};

function roleplayChannelScope(channelId: number, userId: number) {
  return and(eq(roleplayChannels.id, channelId), eq(roleplayChannels.userId, userId));
}

function roleplayMemberScope(channelId: number, userId: number) {
  return and(eq(roleplayChannelMembers.channelId, channelId), eq(roleplayChannelMembers.userId, userId));
}

function roleplayMessageScope(channelId: number, userId: number) {
  return and(eq(roleplayMessages.channelId, channelId), eq(roleplayMessages.userId, userId));
}

/** 与删除人物共用；只串行成员写入，普通生成和消息编辑仍按频道行锁并发。 */
async function lockRoleplayMembershipChanges(tx: DbTransaction, userId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ink-and-kin:roleplay-membership'), ${userId})`);
}

function resetRoleplayGeneration(resetDerived = true) {
  return {
    generationRevision: sql`${roleplayChannels.generationRevision} + 1`,
    updatedAt: new Date(),
    ...(resetDerived ? { directorState: null, runtimeDiagnostics: null } : {}),
  };
}

/** 所有频道写入先锁同一所属频道行，再碰消息或成员，防止插入与清空/改员交错。 */
async function lockRoleplayChannel(tx: DbTransaction, channelId: number, userId: number) {
  const [channel] = await tx.select({
    id: roleplayChannels.id,
    isActive: roleplayChannels.isActive,
    generationRevision: roleplayChannels.generationRevision,
  }).from(roleplayChannels).where(roleplayChannelScope(channelId, userId)).limit(1).for("update");
  return channel;
}

async function resetRoleplayHistoryDerivatives(tx: DbTransaction, channelId: number, userId: number) {
  await tx.update(roleplayChannels).set(resetRoleplayGeneration()).where(roleplayChannelScope(channelId, userId));
  await tx.update(roleplayChannelMembers).set({ lastReadMessageId: 0 })
    .where(roleplayMemberScope(channelId, userId));
}

export class RoleplayGenerationChangedError extends Error {
  constructor() {
    super("角色频道上下文已变化，请重新开始推进");
    this.name = "RoleplayGenerationChangedError";
  }
}

async function assertRoleplayGeneration(
  tx: DbTransaction, channelId: number, userId: number, revision: number, personaIds: number[],
) {
  const channel = await lockRoleplayChannel(tx, channelId, userId);
  if (!channel?.isActive || channel.generationRevision !== revision) throw new RoleplayGenerationChangedError();
  const ids = Array.from(new Set(personaIds));
  if (!ids.length) return;
  const members = await tx.select({ personaId: roleplayChannelMembers.personaId })
    .from(roleplayChannelMembers)
    .innerJoin(personas, eq(roleplayChannelMembers.personaId, personas.id))
    .where(and(
      roleplayMemberScope(channelId, userId),
      inArray(roleplayChannelMembers.personaId, ids),
      eq(roleplayChannelMembers.speakingEnabled, true),
      eq(personas.userId, userId),
      eq(personas.analysisStatus, "ready"),
    ));
  if (members.length !== ids.length) throw new RoleplayGenerationChangedError();
}

/** 辅助模型重试前检查快照，生成写入仍会在行锁内重新校验。 */
export async function isRoleplayGenerationCurrent(channelId: number, userId: number, revision: number) {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db.select({ id: roleplayChannels.id }).from(roleplayChannels).where(and(
    roleplayChannelScope(channelId, userId),
    eq(roleplayChannels.isActive, true),
    eq(roleplayChannels.generationRevision, revision),
  )).limit(1);
  return Boolean(row);
}

/**
 * 创建频道并一次性写入成员。
 *
 * 与自用版一致：至少两个不同人物（频道是多人生活，单人没有轮转意义）；
 * 重复人物去重，displayOrder 按传入顺序落库。返回新频道 id。
 */
export async function createRoleplayChannel(data: InsertRoleplayChannel, memberPersonaIds: number[]) {
  const uniquePersonaIds = Array.from(new Set(memberPersonaIds));
  if (uniquePersonaIds.length < 2) throw new Error("roleplay channel requires at least two personas");

  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return withTransaction(async (tx) => {
    await lockRoleplayMembershipChanges(tx, data.userId);
    const [channel] = await tx.insert(roleplayChannels).values(data).returning();
    const memberRows: InsertRoleplayChannelMember[] = uniquePersonaIds.map((personaId, index) => ({
      channelId: channel.id,
      userId: data.userId,
      personaId,
      displayOrder: index,
    }));
    await tx.insert(roleplayChannelMembers).values(memberRows);
    return channel.id;
  });
}

/**
 * 更新频道设定；只有归属本人（userId 匹配）的频道会被改到。
 *
 * memberPersonaIds 存在（>=2）时整体替换成员：删除本人频道下的旧成员再按新顺序写入。
 * 与自用版一致，替换会重置成员游标（lastReadMessageId）；频道消息不删。
 */
export async function updateRoleplayChannel(
  channelId: number,
  userId: number,
  data: Partial<InsertRoleplayChannel>,
  memberPersonaIds?: number[],
) {
  const uniquePersonaIds = memberPersonaIds && Array.from(new Set(memberPersonaIds));
  if (uniquePersonaIds && uniquePersonaIds.length < 2) throw new Error("roleplay channel requires at least two personas");
  await withTransaction(async (tx) => {
    if (uniquePersonaIds) await lockRoleplayMembershipChanges(tx, userId);
    if (!await lockRoleplayChannel(tx, channelId, userId)) return;
    await tx.update(roleplayChannels)
      .set({ ...data, ...resetRoleplayGeneration() })
      .where(roleplayChannelScope(channelId, userId));
    if (uniquePersonaIds) {
      await tx.delete(roleplayChannelMembers)
        .where(roleplayMemberScope(channelId, userId));
      const memberRows: InsertRoleplayChannelMember[] = uniquePersonaIds.map((personaId, index) => ({
        channelId,
        userId,
        personaId,
        displayOrder: index,
      }));
      await tx.insert(roleplayChannelMembers).values(memberRows);
    }
  });
}

/** 用户全部频道（按最近更新排序），每个频道带上成员视图。 */
export async function getRoleplayChannels(userId: number): Promise<RoleplayChannelView[]> {
  const db = await getDb();
  if (!db) return [];
  const channels = await db.select().from(roleplayChannels)
    .where(eq(roleplayChannels.userId, userId))
    .orderBy(desc(roleplayChannels.updatedAt));

  const result: RoleplayChannelView[] = [];
  for (const channel of channels) {
    result.push({
      ...channel,
      members: await getRoleplayChannelMembers(channel.id, userId),
    });
  }
  return result;
}

/** 单个频道（含成员）；不是本人频道时返回 undefined，由路由层翻译成 NOT_FOUND。 */
export async function getRoleplayChannelById(channelId: number, userId: number): Promise<RoleplayChannelView | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [channel] = await db.select().from(roleplayChannels)
    .where(and(eq(roleplayChannels.id, channelId), eq(roleplayChannels.userId, userId)))
    .limit(1);
  if (!channel) return undefined;
  return {
    ...channel,
    members: await getRoleplayChannelMembers(channelId, userId),
  };
}

/** 频道运行诊断快照：每轮发言后由生成侧写入（最近一轮时间/节奏导演反思/策略/风险提示）。 */
export async function updateRoleplayChannelDiagnostics(
  channelId: number,
  userId: number,
  diagnostics: Record<string, unknown>,
  revision: number,
  personaIds: number[],
  executor?: DbTransaction,
) {
  const write = async (tx: DbTransaction) => {
    await assertRoleplayGeneration(tx, channelId, userId, revision, personaIds);
    await tx.update(roleplayChannels).set({ runtimeDiagnostics: diagnostics })
      .where(roleplayChannelScope(channelId, userId));
  };
  return executor ? write(executor) : withTransaction(write);
}

/** 读取频道的导演线状态（原始 JSON，解析交给生成侧）。 */
export async function getRoleplayChannelDirectorState(
  channelId: number,
  userId: number,
): Promise<unknown | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ directorState: roleplayChannels.directorState })
    .from(roleplayChannels)
    .where(and(eq(roleplayChannels.id, channelId), eq(roleplayChannels.userId, userId)))
    .limit(1);
  return (rows[0] as { directorState?: unknown } | undefined)?.directorState ?? null;
}

/** 写入频道的导演线状态。 */
export async function setRoleplayChannelDirectorState(
  channelId: number,
  userId: number,
  directorState: Record<string, unknown> | null,
  revision: number,
  personaIds: number[],
  executor?: DbTransaction,
): Promise<void> {
  const write = async (tx: DbTransaction) => {
    await assertRoleplayGeneration(tx, channelId, userId, revision, personaIds);
    await tx.update(roleplayChannels).set({ directorState }).where(roleplayChannelScope(channelId, userId));
  };
  return executor ? write(executor) : withTransaction(write);
}

/**
 * 频道成员视图：join personas 拿名字/头像/情绪/分析状态。
 *
 * 三重条件（频道 + 成员归属 + 人物归属）确保即使存在脏数据，也不会把
 * 别人的人物资料带进当前用户的频道。
 */
export async function getRoleplayChannelMembers(channelId: number, userId: number): Promise<RoleplayChannelMemberView[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: roleplayChannelMembers.id,
    channelId: roleplayChannelMembers.channelId,
    personaId: roleplayChannelMembers.personaId,
    displayOrder: roleplayChannelMembers.displayOrder,
    speakingEnabled: roleplayChannelMembers.speakingEnabled,
    lastReadMessageId: roleplayChannelMembers.lastReadMessageId,
    personaName: personas.name,
    avatarUrl: personas.avatarUrl,
    emotionalState: personas.emotionalState,
    analysisStatus: personas.analysisStatus,
  })
    .from(roleplayChannelMembers)
    .innerJoin(personas, eq(roleplayChannelMembers.personaId, personas.id))
    .where(and(
      eq(roleplayChannelMembers.channelId, channelId),
      eq(roleplayChannelMembers.userId, userId),
      eq(personas.userId, userId),
    ))
    .orderBy(asc(roleplayChannelMembers.displayOrder), asc(roleplayChannelMembers.id));
}

/** 频道最近 limit 条消息，按 id 升序返回（时间线与渲染都按它来）。 */
export async function getRoleplayChannelMessages(channelId: number, userId: number, limit = 80) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(roleplayMessages)
    .where(and(eq(roleplayMessages.channelId, channelId), eq(roleplayMessages.userId, userId)))
    .orderBy(desc(roleplayMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** 不自动重试包含消息 INSERT 的事务，避免应答丢失后重复已提交的拍。 */
export async function withRoleplayBeatTransaction<T>(write: (tx: DbTransaction) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(write);
}

/**
 * 写入一条频道消息，并刷新频道 updatedAt。
 * 用户消息使正在生成的快照失效；角色消息仅允许由当前版本的生成任务提交。
 */
export async function createRoleplayMessage(
  data: InsertRoleplayMessage, generationRevision?: number, executor?: DbTransaction,
) {
  const { channelId, userId } = data;
  const write = async (tx: DbTransaction) => {
    if (data.role === "persona") {
      if (generationRevision === undefined || !data.personaId) throw new RoleplayGenerationChangedError();
      await assertRoleplayGeneration(tx, channelId, userId, generationRevision, [data.personaId]);
    } else if (!await lockRoleplayChannel(tx, channelId, userId)) {
      throw new Error("角色频道不存在");
    }
    const [result] = await tx.insert(roleplayMessages).values({ ...data, mode: data.mode ?? "channel" }).returning();
    await tx.update(roleplayChannels)
      .set(data.role === "persona" ? { updatedAt: new Date() } : resetRoleplayGeneration(false))
      .where(roleplayChannelScope(channelId, userId));
    return result;
  };
  return executor ? write(executor) : withRoleplayBeatTransaction(write);
}

/** 更新某个人物在某频道的已读游标（生成侧每轮推进后调用）。 */
export async function updateRoleplayMemberCursor(
  channelId: number, userId: number, personaId: number, lastReadMessageId: number, revision: number,
  executor?: DbTransaction,
) {
  const write = async (tx: DbTransaction) => {
    await assertRoleplayGeneration(tx, channelId, userId, revision, [personaId]);
    await tx.update(roleplayChannelMembers).set({ lastReadMessageId })
      .where(and(roleplayMemberScope(channelId, userId), eq(roleplayChannelMembers.personaId, personaId)));
  };
  return executor ? write(executor) : withTransaction(write);
}

/** 删除频道及其消息、成员；全部按 userId 收窄，删别人的频道不会命中任何行。 */
export async function deleteRoleplayChannel(channelId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await withTransaction(async (tx) => {
    if (!await lockRoleplayChannel(tx, channelId, userId)) return;
    await tx.delete(roleplayMessages).where(roleplayMessageScope(channelId, userId));
    await tx.delete(roleplayChannelMembers).where(roleplayMemberScope(channelId, userId));
    await tx.delete(roleplayChannels).where(roleplayChannelScope(channelId, userId));
  });
}

/**
 * 批量设置消息的上下文包含状态（auto=null，跟随会话边界）。
 *
 * 只更新「本频道 + 本人」的消息；返回本次请求命中的消息条数（与自用版一致，
 * 前端用它提示"已更新 N 条"）。
 */
export async function setRoleplayMessageContextInclusion(
  channelId: number,
  userId: number,
  messageIds: number[],
  status: "included" | "excluded" | "auto",
) {
  const db = await getDb();
  if (!db || messageIds.length === 0) return { updated: 0 };
  const override = status === "auto" ? null : status;
  return withTransaction(async tx => {
    if (!await lockRoleplayChannel(tx, channelId, userId)) return { updated: 0 };
    const rows = await tx.update(roleplayMessages).set({ contextOverride: override })
      .where(and(roleplayMessageScope(channelId, userId), inArray(roleplayMessages.id, messageIds)))
      .returning({ id: roleplayMessages.id });
    if (rows.length) await resetRoleplayHistoryDerivatives(tx, channelId, userId);
    return { updated: rows.length };
  });
}

/** 设置频道内全部消息的上下文包含状态。 */
export async function setAllRoleplayMessagesContextInclusion(
  channelId: number,
  userId: number,
  status: "included" | "excluded" | "auto",
) {
  const db = await getDb();
  if (!db) return { updated: 0 };
  const override = status === "auto" ? null : status;
  return withTransaction(async tx => {
    if (!await lockRoleplayChannel(tx, channelId, userId)) return { updated: 0 };
    const rows = await tx.update(roleplayMessages).set({ contextOverride: override })
      .where(roleplayMessageScope(channelId, userId)).returning({ id: roleplayMessages.id });
    if (rows.length) await resetRoleplayHistoryDerivatives(tx, channelId, userId);
    return { updated: rows.length };
  });
}

/** 删除频道内指定消息（只删本频道 + 本人的行）。 */
export async function deleteRoleplayMessages(
  channelId: number,
  userId: number,
  messageIds: number[],
) {
  const db = await getDb();
  if (!db || messageIds.length === 0) return { deletedMessages: 0 };
  return withTransaction(async tx => {
    if (!await lockRoleplayChannel(tx, channelId, userId)) return { deletedMessages: 0 };
    const rows = await tx.delete(roleplayMessages)
      .where(and(roleplayMessageScope(channelId, userId), inArray(roleplayMessages.id, messageIds)))
      .returning({ id: roleplayMessages.id });
    if (rows.length) await resetRoleplayHistoryDerivatives(tx, channelId, userId);
    return { deletedMessages: rows.length };
  });
}

/** 编辑一条频道消息的内容（频道 + 用户 + 消息 id 三重收窄）。 */
export async function updateRoleplayMessageContent(
  channelId: number,
  userId: number,
  messageId: number,
  content: string,
) {
  const db = await getDb();
  if (!db) return null;
  return withTransaction(async tx => {
    if (!await lockRoleplayChannel(tx, channelId, userId)) return { success: false };
    const rows = await tx.update(roleplayMessages).set({ content })
      .where(and(roleplayMessageScope(channelId, userId), eq(roleplayMessages.id, messageId)))
      .returning({ id: roleplayMessages.id });
    if (rows.length) await resetRoleplayHistoryDerivatives(tx, channelId, userId);
    return { success: rows.length > 0 };
  });
}

/**
 * 清空频道全部消息。
 *
 * 同一事务清掉导演线、运行诊断与成员游标，并使所有旧生成快照失效。
 */
export async function clearAllRoleplayMessages(
  channelId: number,
  userId: number,
) {
  const db = await getDb();
  if (!db) return { deletedMessages: 0 };
  return withTransaction(async tx => {
    if (!await lockRoleplayChannel(tx, channelId, userId)) return { deletedMessages: 0 };
    const rows = await tx.delete(roleplayMessages).where(roleplayMessageScope(channelId, userId))
      .returning({ id: roleplayMessages.id });
    await resetRoleplayHistoryDerivatives(tx, channelId, userId);
    return { deletedMessages: rows.length };
  });
}

/** 诊断面板：消息与上下文按当前频道，模型用量按当前账号全部角色频道。 */
export type RoleplayChannelStats = {
  totalMessages: number;
  includedMessages: number;
  excludedMessages: number;
  bySpeaker: Array<{ speakerName: string; count: number }>;
  lastMessageAt: string | null;
  lastMessageSpeaker: string | null;
  firstMessageAt: string | null;
  memory: {
    scenePromptChars: number;
    contextSeedPreview: string;
    includedCount: number;
    excludedCount: number;
    totalCount: number;
    contextWindowLimit: number;
    currentEstimatedTokens: number;
    isolationMode: string;
  };
  llm: {
    scope: "account_roleplay";
    todayCalls: number;
    todayTokens: number;
    todayInputTokens: number;
    todayOutputTokens: number;
    totalCalls: number;
    totalTokens: number;
    avgDurationMs: number;
    routes: Array<{ route: string; calls: number; totalTokens: number }>;
  };
};

/** 当前频道的消息与记忆统计，以及当前账号全部角色频道的模型用量。 */
export async function getRoleplayChannelStats(
  channelId: number,
  userId: number,
): Promise<RoleplayChannelStats | null> {
  const db = await getDb();
  if (!db) return null;

  const [channelRow] = await db.select({
    id: roleplayChannels.id,
    scenePrompt: roleplayChannels.scenePrompt,
    description: roleplayChannels.description,
  })
    .from(roleplayChannels)
    .where(and(eq(roleplayChannels.id, channelId), eq(roleplayChannels.userId, userId)))
    .limit(1);
  if (!channelRow) return null;

  const [totalRow] = await db.select({ c: count() }).from(roleplayMessages)
    .where(and(eq(roleplayMessages.channelId, channelId), eq(roleplayMessages.userId, userId)));
  const [includedRow] = await db.select({ c: count() }).from(roleplayMessages)
    .where(and(
      eq(roleplayMessages.channelId, channelId),
      eq(roleplayMessages.userId, userId),
      sql`COALESCE(${roleplayMessages.contextOverride}, 'auto') <> 'excluded'`,
    ));
  const [excludedRow] = await db.select({ c: count() }).from(roleplayMessages)
    .where(and(
      eq(roleplayMessages.channelId, channelId),
      eq(roleplayMessages.userId, userId),
      eq(roleplayMessages.contextOverride, "excluded"),
    ));

  const speakerRows = await db.select({
    speakerName: roleplayMessages.speakerName,
    count: count(),
  })
    .from(roleplayMessages)
    .where(and(
      eq(roleplayMessages.channelId, channelId),
      eq(roleplayMessages.userId, userId),
      eq(roleplayMessages.role, "persona"),
    ))
    .groupBy(roleplayMessages.speakerName)
    .orderBy(desc(count()));

  const [firstRow] = await db.select({ createdAt: roleplayMessages.createdAt })
    .from(roleplayMessages)
    .where(and(eq(roleplayMessages.channelId, channelId), eq(roleplayMessages.userId, userId)))
    .orderBy(asc(roleplayMessages.id))
    .limit(1);
  const [lastRow] = await db.select({ createdAt: roleplayMessages.createdAt, speakerName: roleplayMessages.speakerName })
    .from(roleplayMessages)
    .where(and(eq(roleplayMessages.channelId, channelId), eq(roleplayMessages.userId, userId)))
    .orderBy(desc(roleplayMessages.id))
    .limit(1);

  // 用量表只记录账号及用途，按 UTC 日切，无法拆到单一频道。
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [llmTodayRow] = await db.select({
    calls: count(),
    inputTokens: sum(llmUsageRecords.inputTokens),
    outputTokens: sum(llmUsageRecords.outputTokens),
    totalTokens: sum(llmUsageRecords.totalTokens),
    avgDurationMs: sql<number>`coalesce(avg(${llmUsageRecords.durationMs}), 0)`,
  })
    .from(llmUsageRecords)
    .where(and(
      eq(llmUsageRecords.userId, userId),
      or(
        eq(llmUsageRecords.purpose, "roleplay"),
        ilike(llmUsageRecords.route, "roleplay.%"),
      ),
      gte(llmUsageRecords.startedAt, todayStart),
    ));

  const [llmTotalRow] = await db.select({
    calls: count(),
    totalTokens: sum(llmUsageRecords.totalTokens),
  })
    .from(llmUsageRecords)
    .where(and(
      eq(llmUsageRecords.userId, userId),
      or(
        eq(llmUsageRecords.purpose, "roleplay"),
        ilike(llmUsageRecords.route, "roleplay.%"),
      ),
    ));

  const routeRows = await db.select({
    route: sql<string>`coalesce(${llmUsageRecords.route}, 'unknown')`,
    calls: count(),
    totalTokens: sum(llmUsageRecords.totalTokens),
  })
    .from(llmUsageRecords)
    .where(and(
      eq(llmUsageRecords.userId, userId),
      or(
        eq(llmUsageRecords.purpose, "roleplay"),
        ilike(llmUsageRecords.route, "roleplay.%"),
      ),
      gte(llmUsageRecords.startedAt, todayStart),
    ))
    .groupBy(sql`coalesce(${llmUsageRecords.route}, 'unknown')`)
    .orderBy(desc(count()));

  const scenePromptText = channelRow.scenePrompt || "";
  const totalCount = Number(totalRow?.c ?? 0);
  const includedCount = Number(includedRow?.c ?? 0);
  const excludedCount = Number(excludedRow?.c ?? 0);
  const estimatedChars = scenePromptText.length + (includedCount * 120);
  const currentEstimatedTokens = Math.round(estimatedChars / 1.5);

  return {
    totalMessages: totalCount,
    includedMessages: includedCount,
    excludedMessages: excludedCount,
    bySpeaker: speakerRows.map(row => ({ speakerName: row.speakerName, count: Number(row.count) })),
    firstMessageAt: firstRow?.createdAt ? firstRow.createdAt.toISOString() : null,
    lastMessageAt: lastRow?.createdAt ? lastRow.createdAt.toISOString() : null,
    lastMessageSpeaker: lastRow?.speakerName ?? null,
    memory: {
      scenePromptChars: scenePromptText.length,
      contextSeedPreview: scenePromptText.slice(0, 160) || "自由生活场景，未设定前情种子",
      includedCount,
      excludedCount,
      totalCount,
      contextWindowLimit: 6500,
      currentEstimatedTokens,
      isolationMode: "原著人物隔离 · 纯当下生活情景",
    },
    llm: {
      scope: "account_roleplay",
      todayCalls: Number(llmTodayRow?.calls ?? 0),
      todayTokens: Number(llmTodayRow?.totalTokens ?? 0),
      todayInputTokens: Number(llmTodayRow?.inputTokens ?? 0),
      todayOutputTokens: Number(llmTodayRow?.outputTokens ?? 0),
      totalCalls: Number(llmTotalRow?.calls ?? 0),
      totalTokens: Number(llmTotalRow?.totalTokens ?? 0),
      avgDurationMs: Math.round(Number(llmTodayRow?.avgDurationMs ?? 0)),
      routes: routeRows.map(row => ({
        route: row.route,
        calls: Number(row.calls),
        totalTokens: Number(row.totalTokens ?? 0),
      })),
    },
  };
}
