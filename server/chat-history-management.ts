/** Backup selected scene messages and their linked memories before deleting them. */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, or } from "drizzle-orm";
import { memories, messages } from "../drizzle/schema";
import { memoryReviewProvenance } from "../drizzle/memory-review-schema";
import {
  getDb, invalidateSceneMessageContext, lockChatContext, lockPersonaForSceneMessageChanges, lockSceneForContext,
} from "./db";
import { TRPCError } from "@trpc/server";

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
  sceneId: number;
  messageIds?: number[];
  deleteLinkedMemories?: boolean;
  resetRuntimeCaches?: boolean;
}) {
  const database = await getDb();
  if (!database) throw new Error("DB not available");
  const { userId, personaId, sceneId } = options;
  const requestedIds = options.messageIds
    ? Array.from(new Set(options.messageIds.filter(id => Number.isSafeInteger(id) && id > 0)))
    : undefined;

  return database.transaction(async tx => {
    const context = await lockChatContext(tx, personaId, userId);
    await lockPersonaForSceneMessageChanges(tx, personaId, userId);
    if (!await lockSceneForContext(tx, userId, sceneId)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "场景不存在。" });
    }
    const scope = and(eq(messages.personaId, personaId), eq(messages.userId, userId),
      eq(messages.sceneId, sceneId), eq(messages.mode, "scene"));
    const selectedMessages = requestedIds?.length === 0 ? [] : await tx.select().from(messages)
      .where(and(scope, requestedIds ? inArray(messages.id, requestedIds) : undefined))
      .orderBy(messages.id).for("update");
    if (selectedMessages.length === 0) {
      // An empty clear-all still cancels generations that have not stored their first message.
      if (requestedIds === undefined) await invalidateSceneMessageContext(tx, context, sceneId);
      return { deletedMessages: 0, deletedMemories: 0, backupPath: null, backupFileName: null };
    }

    // Read links after locking the exact message rows that will be deleted.
    const selectedIds = new Set(selectedMessages.map(message => message.id));
    const messageIds = Array.from(selectedIds);
    const provenance = options.deleteLinkedMemories ? await tx.select().from(memoryReviewProvenance)
      .where(and(eq(memoryReviewProvenance.personaId, personaId), eq(memoryReviewProvenance.userId, userId))) : [];
    const referencedMemoryIds = provenance.flatMap(row =>
      row.memoryId !== null && Array.isArray(row.evidence) &&
      row.evidence.some(ref => ref.type === "message" && selectedIds.has(ref.messageId))
        ? [row.memoryId] : [],
    );
    const memoryScope = and(eq(memories.personaId, personaId), eq(memories.userId, userId));
    const linkedMemories = options.deleteLinkedMemories ? await tx.select().from(memories)
      .where(and(memoryScope, or(inArray(memories.messageId, messageIds),
        referencedMemoryIds.length ? inArray(memories.id, referencedMemoryIds) : undefined)))
      .orderBy(memories.id).for("update") : [];
    const linkedIds = new Set(linkedMemories.map(row => row.id));

    const root = backupRoot();
    await fs.mkdir(root, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFileName = `chat-delete-persona-${personaId}-${stamp}-${randomUUID()}.json`;
    const backupPath = path.join(root, backupFileName);
    await fs.writeFile(backupPath, JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      personaId,
      userId,
      sceneId,
      options: {
        deleteLinkedMemories: options.deleteLinkedMemories === true,
        resetRuntimeCaches: options.resetRuntimeCaches === true,
      },
      messages: selectedMessages,
      linkedMemories,
      linkedProvenance: provenance.filter(row => row.memoryId !== null && linkedIds.has(row.memoryId)),
    }, null, 2), { encoding: "utf8", flag: "wx" });

    if (linkedIds.size) await tx.delete(memories).where(and(memoryScope, inArray(memories.id, Array.from(linkedIds))));
    await tx.delete(messages).where(and(scope, inArray(messages.id, messageIds)));
    await invalidateSceneMessageContext(tx, context, sceneId);

    return {
      deletedMessages: selectedMessages.length,
      deletedMemories: linkedMemories.length,
      backupPath,
      backupFileName,
    };
  });
}
