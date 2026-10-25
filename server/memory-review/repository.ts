import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { memories, messages, personas, scenes } from "../../drizzle/schema";
import { sourceLibraryChunks, sourceLibraryDocuments } from "../../drizzle/source-library-schema";
import { memoryReviewCandidates as candidates, memoryReviewOperations as operations, memoryReviewProvenance as provenance } from "../../drizzle/memory-review-schema";
import { factFingerprint, MemoryReviewError, type EvidenceReference, type MemoryProvenance, type ReviewCandidate, type ReviewEvidence, type StoredReviewResult } from "./core";
import type { CurrentEvidence, MemoryReviewRepository, ReviewTransaction } from "./service";

function candidate(row: typeof candidates.$inferSelect): ReviewCandidate {
  return {
    ...row, kind: row.kind as ReviewCandidate["kind"], category: row.category as ReviewCandidate["category"],
    evidence: row.evidence as ReviewEvidence[], evidenceStatus: row.evidenceStatus as ReviewCandidate["evidenceStatus"],
    status: row.status as ReviewCandidate["status"], application: row.application as ReviewCandidate["application"],
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function candidateValues(value: ReviewCandidate | Omit<ReviewCandidate, "id">) {
  return {
    userId: value.userId, personaId: value.personaId, kind: value.kind, title: value.title, description: value.description,
    confidence: value.confidence, importance: value.importance, source: value.source, memoryType: value.memoryType,
    keywords: value.keywords, emotion: value.emotion, sceneId: value.sceneId, factKey: value.factKey, date: value.date,
    category: value.category, evidence: value.evidence, evidenceStatus: value.evidenceStatus,
    status: value.status, revision: value.revision, memoryId: value.memoryId, application: value.application,
    createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt),
  };
}

function provenanceRow(row: typeof provenance.$inferSelect): MemoryProvenance {
  return {
    candidateId: row.candidateId, userId: row.userId, personaId: row.personaId,
    kind: row.kind as MemoryProvenance["kind"], memoryId: row.memoryId, fingerprint: row.fingerprint,
    evidenceStatus: row.evidenceStatus as MemoryProvenance["evidenceStatus"], evidence: row.evidence as ReviewEvidence[],
    application: row.application as MemoryProvenance["application"],
  };
}

async function database() {
  const db = await getDb();
  if (!db) throw new MemoryReviewError("CONFLICT", "数据库暂不可用，请稍后重试。");
  return db;
}

async function ownedDatabase(userId: number, personaId: number) {
  const db = await database();
  const rows = await db.select({ id: personas.id }).from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  if (!rows.length) throw new MemoryReviewError("NOT_FOUND", "角色不存在或不属于当前账号。");
  return db;
}

function candidateScope(userId: number, personaId: number) {
  return and(eq(candidates.userId, userId), eq(candidates.personaId, personaId), eq(personas.id, personaId), eq(personas.userId, userId));
}

/** Locked acceptance and read-only projection use exactly the same owner filters. */
async function currentEvidence(db: any, userId: number, personaId: number, reference: EvidenceReference, locked: boolean): Promise<CurrentEvidence | null> {
  if (reference.type === "message") {
    const query = db.select({ text: messages.content, role: messages.role }).from(messages)
      .innerJoin(personas, eq(personas.id, messages.personaId))
      .where(and(eq(messages.id, reference.messageId), eq(messages.userId, userId), eq(messages.personaId, personaId), eq(personas.userId, userId))).limit(1);
    const rows = locked ? await query.for("share") : await query;
    return rows[0] ?? null;
  }
  const query = db.select({ text: sourceLibraryChunks.content }).from(sourceLibraryChunks)
    .innerJoin(sourceLibraryDocuments, eq(sourceLibraryChunks.documentId, sourceLibraryDocuments.id))
    .innerJoin(personas, eq(personas.id, sourceLibraryDocuments.personaId))
    .where(and(eq(sourceLibraryDocuments.id, reference.documentId), eq(sourceLibraryChunks.chunkIndex, reference.chunkIndex),
      eq(sourceLibraryDocuments.userId, userId), eq(sourceLibraryDocuments.personaId, personaId), eq(personas.userId, userId))).limit(1);
  const rows = locked ? await query.for("share") : await query;
  return rows[0] ?? null;
}

function currentMemoryFingerprint(memory: typeof memories.$inferSelect): string {
  return factFingerprint({ kind: "user_fact", title: memory.title, description: memory.description ?? "", date: memory.date, category: memory.category, factKey: memory.factKey });
}

export function createMemoryReviewRepository(): MemoryReviewRepository {
  return {
    async transaction(userId, personaId, operationId, work) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) throw new MemoryReviewError("BAD_REQUEST", "请提供有效的操作编号。");
      const operationKey = operationId.toLowerCase();
      const db = await database();
      return db.transaction(async tx => {
        const owner = await tx.select({ id: personas.id }).from(personas)
          .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1).for("share");
        if (!owner.length) throw new MemoryReviewError("NOT_FOUND", "角色不存在或不属于当前账号。");
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ink-and-kin:memory-review-operation'), hashtext(${`${userId}:${operationKey}`}))`);

        const unit: ReviewTransaction = {
          async getOperation() {
            const rows = await tx.select().from(operations).where(and(eq(operations.userId, userId), eq(operations.operationId, operationKey))).limit(1);
            if (rows[0] && rows[0].personaId !== personaId) throw new MemoryReviewError("CONFLICT", "此操作编号已用于另一个角色，请使用新的操作编号。");
            return rows[0] ? { requestHash: rows[0].requestHash, result: rows[0].result as StoredReviewResult } : null;
          },
          async saveOperation(requestHash, result) {
            await tx.insert(operations).values({ userId, personaId, operationId: operationKey, requestHash, result });
          },
          async getCandidate(id) {
            const rows = await tx.select().from(candidates).where(and(eq(candidates.id, id), eq(candidates.userId, userId), eq(candidates.personaId, personaId))).limit(1).for("update");
            return rows[0] ? candidate(rows[0]) : null;
          },
          async insertCandidate(value) {
            const rows = await tx.insert(candidates).values(candidateValues({ ...value, userId, personaId })).returning();
            return candidate(rows[0]);
          },
          async updateCandidate(value, expectedRevision) {
            if (value.revision !== expectedRevision + 1) throw new MemoryReviewError("CONFLICT", "候选版本已变化，请刷新后重新审阅。");
            const rows = await tx.update(candidates).set(candidateValues({ ...value, userId, personaId }))
              .where(and(eq(candidates.id, value.id), eq(candidates.userId, userId), eq(candidates.personaId, personaId), eq(candidates.revision, expectedRevision), eq(candidates.status, "pending"))).returning();
            if (!rows[0]) throw new MemoryReviewError("CONFLICT", "候选已被修改或审阅，请刷新后重试。");
            return candidate(rows[0]);
          },
          async ownsScene(sceneId) {
            const rows = await tx.select({ id: scenes.id }).from(scenes)
              .where(and(eq(scenes.id, sceneId), or(eq(scenes.userId, userId), eq(scenes.isBuiltin, true)))).limit(1).for("share");
            return rows.length > 0;
          },
          resolveEvidence(reference) { return currentEvidence(tx, userId, personaId, reference, true); },
          async findExistingMemory(value, fingerprint) {
            const factSlot = value.factKey || fingerprint;
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ink-and-kin:memory-review-fact'), hashtext(${`${userId}:${personaId}:${factSlot}`}))`);
            const active = and(eq(memories.userId, userId), eq(memories.personaId, personaId), eq(memories.status, "active"));
            // A keyed conflict never overwrites a fact or advances the candidate.
            if (value.factKey) {
              const keyed = await tx.select().from(memories).where(and(active, eq(memories.factKey, value.factKey))).for("share");
              if (keyed.some(row => currentMemoryFingerprint(row) !== fingerprint)) throw new MemoryReviewError("CONFLICT", "同一事实键已有不同内容，请单独核对；旧记忆未被覆盖，候选仍待审阅。");
              if (keyed[0]) return keyed[0].id;
            }
            const adopted = await tx.select({ memory: memories }).from(provenance).innerJoin(memories, eq(provenance.memoryId, memories.id))
              .where(and(eq(provenance.userId, userId), eq(provenance.personaId, personaId), eq(provenance.fingerprint, fingerprint),
                eq(provenance.kind, "user_fact"), eq(provenance.application, "memory"), active)).for("share");
            // Manual edits can leave a historical provenance hash behind. Compare current content.
            const unchanged = adopted.find(row => currentMemoryFingerprint(row.memory) === fingerprint);
            if (unchanged) return unchanged.memory.id;
            const existing = await tx.select({ id: memories.id }).from(memories)
              .where(and(active, eq(memories.title, value.title), eq(memories.description, value.description), eq(memories.category, value.category),
                sql`${memories.date} IS NOT DISTINCT FROM ${value.date}`, sql`${memories.factKey} IS NOT DISTINCT FROM ${value.factKey}`)).limit(1).for("share");
            return existing[0]?.id ?? null;
          },
          async insertMemory(value) {
            if (value.kind !== "user_fact") throw new MemoryReviewError("BAD_REQUEST", "只有经审阅的用户现实事实可以写入长期记忆。");
            const rows = await tx.insert(memories).values({
              userId, personaId, title: value.title, description: value.description, category: value.category, date: value.date, factKey: value.factKey,
              importance: value.importance, confidence: value.confidence, source: value.source, memoryType: value.memoryType,
              keywords: value.keywords, emotion: value.emotion || null, status: "active", revision: 1, isPinned: false,
            }).returning({ id: memories.id });
            return rows[0].id;
          },
          async insertProvenance(value) {
            const rows = await tx.select().from(candidates).where(and(eq(candidates.id, value.candidateId), eq(candidates.userId, userId), eq(candidates.personaId, personaId), eq(candidates.status, "accepted"))).limit(1);
            if (!rows[0] || rows[0].kind !== value.kind || rows[0].memoryId !== value.memoryId) throw new MemoryReviewError("CONFLICT", "候选归属或审阅结果已变化，未保存来源记录。");
            if (value.memoryId !== null) {
              const memory = await tx.select({ id: memories.id }).from(memories)
                .where(and(eq(memories.id, value.memoryId), eq(memories.userId, userId), eq(memories.personaId, personaId), eq(memories.status, "active"))).limit(1).for("share");
              if (!memory.length) throw new MemoryReviewError("NOT_FOUND", "目标记忆不存在或已失效。");
            }
            await tx.insert(provenance).values({ ...value, userId, personaId });
          },
        };
        return work(unit);
      });
    },

    async list(userId, personaId, status) {
      const db = await ownedDatabase(userId, personaId);
      const rows = await db.select({ row: candidates }).from(candidates).innerJoin(personas, eq(personas.id, candidates.personaId))
        .where(and(candidateScope(userId, personaId), status ? eq(candidates.status, status) : undefined))
        .orderBy(desc(candidates.updatedAt), desc(candidates.id)).limit(200);
      return rows.map(value => candidate(value.row));
    },

    async provenance(userId, personaId, memoryIds) {
      const db = await ownedDatabase(userId, personaId);
      const ids = Array.from(new Set(memoryIds.filter(id => Number.isSafeInteger(id) && id > 0)));
      const result: MemoryProvenance[] = [];
      // Do not truncate provenance: a missing row must never turn a reviewed memory into a legacy one.
      for (let start = 0; start < ids.length; start += 500) {
        const rows = await db.select({ row: provenance }).from(provenance)
          .innerJoin(candidates, eq(provenance.candidateId, candidates.id)).innerJoin(personas, eq(personas.id, candidates.personaId))
          .where(and(eq(provenance.userId, userId), eq(provenance.personaId, personaId), candidateScope(userId, personaId), eq(candidates.status, "accepted"), inArray(provenance.memoryId, ids.slice(start, start + 500))));
        result.push(...rows.map(value => provenanceRow(value.row)));
      }
      return result;
    },

    async reviewedFacts(userId, personaId, kind, sceneId) {
      const db = await ownedDatabase(userId, personaId);
      if (kind === "story_event" && sceneId == null) return [];
      const sceneScope = kind === "story_event" ? sql`EXISTS (SELECT 1 FROM ${scenes} WHERE ${scenes.id} = ${sceneId!} AND (${scenes.userId} = ${userId} OR ${scenes.isBuiltin} = true))` : undefined;
      const rows = await db.select({ row: candidates }).from(candidates).innerJoin(personas, eq(personas.id, candidates.personaId))
        .where(and(candidateScope(userId, personaId), eq(candidates.kind, kind), eq(candidates.status, "accepted"), eq(candidates.application, "reviewed_only"),
          kind === "story_event" ? eq(candidates.sceneId, sceneId!) : undefined, sceneScope))
        .orderBy(desc(candidates.updatedAt), desc(candidates.id)).limit(100);
      return rows.map(value => candidate(value.row));
    },

    async resolveCurrentEvidence(userId, personaId, reference) {
      return currentEvidence(await database(), userId, personaId, reference, false);
    },
  };
}
