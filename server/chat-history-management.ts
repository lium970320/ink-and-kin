/**
 * 删除聊天记录前的备份与关联记忆清理（移植自自用版/净化同源候选）。
 *
 * 书中人适配：
 * - messages.contextOverride / sceneId / mode 由手写迁移（0014_scene_state）建立，
 *   不再在运行时 ensure 建列；
 * - 书中人没有 persona_runtime_states（第 7 批才引入），resetRuntimeCaches 目前是
 *   记录型 no-op，等该表落地后在此接回；
 * - 备份目录沿用 INK_AND_KIN_CHAT_BACKUP_DIR，默认放到进程工作目录的 runtime/chat-backups。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { memories, messages } from "../drizzle/schema";
import { getDb } from "./db";

function backupRoot(): string {
  const configured = process.env.INK_AND_KIN_CHAT_BACKUP_DIR?.trim();
  return path.resolve(configured || path.join(process.cwd(), "runtime", "chat-backups"));
}

function linkedEvidenceIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is number => Number.isSafeInteger(id) && id > 0);
}

export function memoryReferencesAnyMessage(
  memory: { messageId?: number | null; evidenceMessageIds?: unknown },
  messageIds: Set<number>,
): boolean {
  if (typeof memory.messageId === "number" && messageIds.has(memory.messageId)) return true;
  return linkedEvidenceIds(memory.evidenceMessageIds).some(id => messageIds.has(id));
}

export async function deleteChatMessagesWithBackup(options: {
  personaId: number;
  userId: number;
  messageIds?: number[];
  deleteLinkedMemories?: boolean;
  resetRuntimeCaches?: boolean;
  sceneId?: number;
}) {
  const database = await getDb();
  if (!database) throw new Error("DB not available");

  const requestedIds = options.messageIds
    ? Array.from(new Set(options.messageIds.filter(id => Number.isSafeInteger(id) && id > 0)))
    : null;
  const selectedMessages = await database.select().from(messages)
    .where(and(
      eq(messages.personaId, options.personaId),
      eq(messages.userId, options.userId),
      ...(requestedIds ? [inArray(messages.id, requestedIds)] : []),
      ...(options.sceneId ? [eq(messages.sceneId, options.sceneId)] : []),
    ))
    .orderBy(messages.id);
  if (selectedMessages.length === 0) {
    return {
      deletedMessages: 0,
      deletedMemories: 0,
      backupPath: null,
      backupFileName: null,
    };
  }

  const selectedIds = new Set(selectedMessages.map(message => message.id));
  const personaMemories = options.deleteLinkedMemories
    ? await database.select().from(memories)
        .where(and(eq(memories.personaId, options.personaId), eq(memories.userId, options.userId)))
    : [];
  const linkedMemories = personaMemories.filter(memory => memoryReferencesAnyMessage(memory, selectedIds));

  const root = backupRoot();
  await fs.mkdir(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `chat-delete-persona-${options.personaId}-${stamp}.json`;
  const backupPath = path.join(root, backupFileName);
  await fs.writeFile(backupPath, JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    personaId: options.personaId,
    userId: options.userId,
    options: {
      deleteLinkedMemories: options.deleteLinkedMemories === true,
      resetRuntimeCaches: options.resetRuntimeCaches === true,
    },
    messages: selectedMessages,
    linkedMemories,
  }, null, 2), "utf8");

  await database.transaction(async tx => {
    if (linkedMemories.length > 0) {
      await tx.delete(memories).where(and(
        eq(memories.personaId, options.personaId),
        eq(memories.userId, options.userId),
        inArray(memories.id, linkedMemories.map(memory => memory.id)),
      ));
    }
    await tx.delete(messages).where(and(
      eq(messages.personaId, options.personaId),
      eq(messages.userId, options.userId),
      inArray(messages.id, Array.from(selectedIds)),
    ));
    if (options.resetRuntimeCaches) {
      // 书中人暂无 persona_runtime_states（第 7 批引入）：运行态缓存清理先作为
      // no-op 保留接口位，避免调用方改参；第 7 批接表后在此补 tx.update。
    }
  });

  return {
    deletedMessages: selectedMessages.length,
    deletedMemories: linkedMemories.length,
    backupPath,
    backupFileName,
  };
}
