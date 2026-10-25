import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { personas } from "../../drizzle/schema";
import { sourceLibraryChunks as chunks, sourceLibraryDocuments as documents } from "../../drizzle/source-library-schema";
import { getDb } from "../db";
import { SOURCE_LIBRARY_LIMITS, SourceLibraryError, type PreparedSource, type SourceDocument, type SourceHit } from "./core";

export type SourceCandidate = Omit<SourceHit, "score">;
export type SourceSeed = { documentId: number; chunkIndex: number };
export type SourceChunkMetadata = { documentId: number; chapterTitle: string; tokenEstimate: number; keywords: string[] };

export interface SourceLibraryRepository {
  ownsPersona(userId: number, personaId: number): Promise<boolean>;
  listDocuments(userId: number, personaId: number): Promise<SourceDocument[]>;
  getDocument(userId: number, personaId: number, documentId: number): Promise<SourceDocument | null>;
  saveDocument(userId: number, personaId: number, source: PreparedSource, replaceId?: number): Promise<SourceDocument>;
  deleteDocument(userId: number, personaId: number, documentId: number): Promise<boolean>;
  searchCandidates(userId: number, personaId: number, terms: string[]): Promise<SourceCandidate[]>;
  neighborCandidates(userId: number, personaId: number, seeds: SourceSeed[]): Promise<SourceCandidate[]>;
  getChunk(userId: number, personaId: number, chunkId: number): Promise<SourceCandidate | null>;
  listChunkMetadata(userId: number, personaId: number): Promise<SourceChunkMetadata[]>;
}

async function database() {
  const db = await getDb();
  if (!db) throw new SourceLibraryError("CONFLICT", "数据库暂不可用，请稍后重试。");
  return db;
}

function ownerScope(userId: number, personaId: number) {
  return and(eq(documents.userId, userId), eq(documents.personaId, personaId), eq(personas.id, personaId), eq(personas.userId, userId));
}

const candidateFields = {
  id: chunks.id, documentId: documents.id, sourceTitle: documents.title,
  chunkIndex: chunks.chunkIndex, chapterTitle: chunks.chapterTitle, content: chunks.content,
  startOffset: chunks.startOffset, endOffset: chunks.endOffset,
  keywords: chunks.keywords, tokenEstimate: chunks.tokenEstimate,
};

function validatePreparedSource(source: PreparedSource): void {
  if (!source.title.trim() || source.title.length > 200 || !source.fileName.trim() || source.fileName.length > 255
    || !["txt", "md", "epub"].includes(source.format) || !/^[a-f0-9]{64}$/i.test(source.fileHash)
    || !Number.isSafeInteger(source.byteSize) || source.byteSize <= 0 || source.byteSize > SOURCE_LIBRARY_LIMITS.maxFileBytes
    || !source.chunks.length || source.chunks.length > SOURCE_LIBRARY_LIMITS.maxChunks) {
    throw new SourceLibraryError("BAD_REQUEST", "原文元数据或分块无效，请重新解析后上传。");
  }
  for (let index = 0; index < source.chunks.length; index++) {
    const chunk = source.chunks[index];
    if (chunk.chunkIndex !== index || chunk.chapterTitle.length > 200 || !chunk.content.trim()
      || !Number.isSafeInteger(chunk.startOffset) || !Number.isSafeInteger(chunk.endOffset)
      || chunk.startOffset < 0 || chunk.endOffset - chunk.startOffset !== chunk.content.length
      || !Number.isSafeInteger(chunk.tokenEstimate) || chunk.tokenEstimate < 0
      || !Array.isArray(chunk.keywords) || !chunk.keywords.every(keyword => typeof keyword === "string")) {
      throw new SourceLibraryError("BAD_REQUEST", "原文分块无效，原资料未被替换。");
    }
  }
}

async function lockPersona(tx: any, userId: number, personaId: number): Promise<boolean> {
  const rows = await tx.select({ id: personas.id }).from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1).for("share");
  return rows.length > 0;
}

function escapeTerm(term: string): string { return term.replace(/[\\%_]/g, "\\$&"); }

export function createSourceLibraryRepository(): SourceLibraryRepository {
  return {
    async ownsPersona(userId, personaId) {
      const db = await database();
      const rows = await db.select({ id: personas.id }).from(personas)
        .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
      return rows.length > 0;
    },

    async listDocuments(userId, personaId) {
      const db = await database();
      const rows = await db.select({ document: documents }).from(documents).innerJoin(personas, eq(personas.id, documents.personaId))
        .where(ownerScope(userId, personaId)).orderBy(desc(documents.createdAt), desc(documents.id));
      return rows.map(row => row.document);
    },

    async getDocument(userId, personaId, documentId) {
      const db = await database();
      const rows = await db.select({ document: documents }).from(documents).innerJoin(personas, eq(personas.id, documents.personaId))
        .where(and(ownerScope(userId, personaId), eq(documents.id, documentId))).limit(1);
      return rows[0]?.document ?? null;
    },

    async saveDocument(userId, personaId, source, replaceId) {
      // Validation completes before opening a transaction or touching old chunks.
      validatePreparedSource(source);
      const db = await database();
      return db.transaction(async tx => {
        if (!await lockPersona(tx, userId, personaId)) throw new SourceLibraryError("NOT_FOUND", "角色不存在或不属于当前账号。");
        const metadata = { userId, personaId, title: source.title, fileName: source.fileName, format: source.format,
          byteSize: source.byteSize, fileHash: source.fileHash.toLowerCase(), chunkCount: source.chunks.length, updatedAt: new Date() };
        let document: typeof documents.$inferSelect;
        if (replaceId !== undefined) {
          const old = await tx.select({ id: documents.id }).from(documents)
            .where(and(eq(documents.id, replaceId), eq(documents.userId, userId), eq(documents.personaId, personaId))).limit(1).for("update");
          if (!old.length) throw new SourceLibraryError("NOT_FOUND", "原文资料不存在或不属于当前角色。");
          const rows = await tx.update(documents).set(metadata)
            .where(and(eq(documents.id, replaceId), eq(documents.userId, userId), eq(documents.personaId, personaId))).returning();
          document = rows[0];
          await tx.delete(chunks).where(eq(chunks.documentId, document.id));
        } else {
          const rows = await tx.insert(documents).values(metadata).returning();
          document = rows[0];
        }
        // Preserve every normalized chunk. Batches stay below PostgreSQL bind limits.
        for (let start = 0; start < source.chunks.length; start += 100) {
          await tx.insert(chunks).values(source.chunks.slice(start, start + 100).map(chunk => ({
            documentId: document.id, chunkIndex: chunk.chunkIndex, chapterTitle: chunk.chapterTitle,
            content: chunk.content, startOffset: chunk.startOffset, endOffset: chunk.endOffset,
            keywords: chunk.keywords, tokenEstimate: chunk.tokenEstimate,
          })));
        }
        return document;
      });
    },

    async deleteDocument(userId, personaId, documentId) {
      const db = await database();
      return db.transaction(async tx => {
        if (!await lockPersona(tx, userId, personaId)) return false;
        const rows = await tx.delete(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId), eq(documents.personaId, personaId))).returning({ id: documents.id });
        // The same statement removes chunks through the cascading foreign key.
        return rows.length > 0;
      });
    },

    async searchCandidates(userId, personaId, terms) {
      const queryTerms = Array.from(new Set(terms.map(term => term.trim()).filter(Boolean))).slice(0, 24);
      if (!queryTerms.length) return [];
      const db = await database();
      const predicates = queryTerms.map(term => {
        const pattern = `%${escapeTerm(term)}%`;
        return or(ilike(chunks.content, pattern), ilike(chunks.chapterTitle, pattern),
          sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${chunks.keywords}) AS keyword(value) WHERE keyword.value ILIKE ${pattern})`)!;
      });
      const matchCount = sql<number>`(${sql.join(predicates.map(predicate => sql`CASE WHEN ${predicate} THEN 1 ELSE 0 END`), sql` + `)})`;
      return db.select(candidateFields).from(chunks).innerJoin(documents, eq(documents.id, chunks.documentId)).innerJoin(personas, eq(personas.id, documents.personaId))
        .where(and(ownerScope(userId, personaId), or(...predicates)))
        .orderBy(desc(matchCount), asc(documents.id), asc(chunks.chunkIndex)).limit(200);
    },

    async neighborCandidates(userId, personaId, seeds) {
      const selected = seeds.slice(0, 8).filter(seed => Number.isSafeInteger(seed.documentId) && seed.documentId > 0 && Number.isSafeInteger(seed.chunkIndex) && seed.chunkIndex >= 0);
      if (!selected.length) return [];
      const db = await database();
      const ranges = selected.map(seed => and(eq(documents.id, seed.documentId), gte(chunks.chunkIndex, Math.max(0, seed.chunkIndex - 1)), lte(chunks.chunkIndex, seed.chunkIndex + 1))!);
      const rows = await db.select(candidateFields).from(chunks).innerJoin(documents, eq(documents.id, chunks.documentId)).innerJoin(personas, eq(personas.id, documents.personaId))
        .where(and(ownerScope(userId, personaId), or(...ranges))).orderBy(asc(documents.id), asc(chunks.chunkIndex)).limit(24);
      return rows.map(row => {
        const closest = selected.map((seed, seedRank) => ({ seed, seedRank, distance: Math.abs(row.chunkIndex - seed.chunkIndex) }))
          .filter(item => item.seed.documentId === row.documentId && item.distance <= 1)
          .sort((left, right) => left.distance - right.distance || left.seedRank - right.seedRank)[0];
        return { ...row, seedRank: closest.seedRank, distanceFromSeed: closest.distance };
      }).sort((left, right) => left.seedRank - right.seedRank || left.distanceFromSeed - right.distanceFromSeed || left.chunkIndex - right.chunkIndex);
    },

    async getChunk(userId, personaId, chunkId) {
      const db = await database();
      const rows = await db.select(candidateFields).from(chunks).innerJoin(documents, eq(documents.id, chunks.documentId)).innerJoin(personas, eq(personas.id, documents.personaId))
        .where(and(ownerScope(userId, personaId), eq(chunks.id, chunkId))).limit(1);
      return rows[0] ?? null;
    },

    async listChunkMetadata(userId, personaId) {
      const db = await database();
      return db.select({ documentId: documents.id, chapterTitle: chunks.chapterTitle, tokenEstimate: chunks.tokenEstimate, keywords: chunks.keywords })
        .from(chunks).innerJoin(documents, eq(documents.id, chunks.documentId)).innerJoin(personas, eq(personas.id, documents.personaId))
        .where(ownerScope(userId, personaId)).orderBy(asc(documents.id), asc(chunks.chunkIndex));
    },
  };
}
