import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { personas, users } from "./schema";

export const sourceLibraryDocuments = pgTable("source_library_documents", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaId: integer("personaId").notNull().references(() => personas.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  format: varchar("format", { length: 8, enum: ["txt", "md", "epub"] }).notNull(),
  byteSize: integer("byteSize").notNull(),
  fileHash: varchar("fileHash", { length: 64 }).notNull(),
  chunkCount: integer("chunkCount").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => ({
  byOwner: index("source_library_documents_owner_idx").on(table.userId, table.personaId, table.createdAt),
  validFormat: check("source_library_documents_format_check", sql`${table.format} IN ('txt', 'md', 'epub')`),
  positiveSize: check("source_library_documents_size_check", sql`${table.byteSize} > 0 AND ${table.chunkCount} > 0`),
  sha256: check("source_library_documents_hash_check", sql`${table.fileHash} ~ '^[0-9a-f]{64}$'`),
}));

export const sourceLibraryChunks = pgTable("source_library_chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("documentId").notNull().references(() => sourceLibraryDocuments.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunkIndex").notNull(),
  chapterTitle: varchar("chapterTitle", { length: 200 }).notNull(),
  content: text("content").notNull(),
  startOffset: integer("startOffset").notNull(),
  endOffset: integer("endOffset").notNull(),
  keywords: jsonb("keywords").$type<string[]>().default([]).notNull(),
  tokenEstimate: integer("tokenEstimate").notNull(),
}, table => ({
  documentPosition: uniqueIndex("source_library_chunks_document_index_idx").on(table.documentId, table.chunkIndex),
  validOffsets: check("source_library_chunks_offsets_check", sql`${table.chunkIndex} >= 0 AND ${table.startOffset} >= 0 AND ${table.endOffset} >= ${table.startOffset}`),
  validTokens: check("source_library_chunks_tokens_check", sql`${table.tokenEstimate} >= 0`),
  keywordArray: check("source_library_chunks_keywords_check", sql`jsonb_typeof(${table.keywords}) = 'array'`),
}));

export type SourceLibraryDocumentRow = typeof sourceLibraryDocuments.$inferSelect;
export type SourceLibraryChunkRow = typeof sourceLibraryChunks.$inferSelect;
