import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { memories, personas, scenes, users } from "./schema";

export const memoryReviewCandidates = pgTable("memory_review_candidates", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaId: integer("personaId").notNull().references(() => personas.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 24 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(), description: text("description").notNull(),
  confidence: integer("confidence").default(3).notNull(), importance: integer("importance").default(3).notNull(),
  source: varchar("source", { length: 24 }).default("chat").notNull(),
  memoryType: varchar("memoryType", { length: 40 }).default("relationship_event").notNull(),
  keywords: jsonb("keywords").$type<string[]>().default([]).notNull(), emotion: varchar("emotion", { length: 120 }).default("").notNull(),
  sceneId: integer("sceneId").references(() => scenes.id, { onDelete: "cascade" }),
  factKey: varchar("factKey", { length: 120 }), date: varchar("date", { length: 50 }),
  category: varchar("category", { length: 24 }).default("memory").notNull(),
  evidence: jsonb("evidence").default([]).notNull(), evidenceStatus: varchar("evidenceStatus", { length: 32 }).default("needs_confirmation").notNull(),
  status: varchar("status", { length: 16 }).default("pending").notNull(), revision: integer("revision").default(1).notNull(),
  memoryId: integer("memoryId").references(() => memories.id, { onDelete: "set null" }),
  application: varchar("application", { length: 24 }).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => ({
  byOwner: index("memory_review_candidates_owner_idx").on(table.userId, table.personaId, table.status, table.updatedAt),
  kind: check("memory_review_candidates_kind_check", sql`${table.kind} IN ('user_fact', 'source_fact', 'story_event')`),
  ratings: check("memory_review_candidates_ratings_check", sql`${table.confidence} BETWEEN 1 AND 5 AND ${table.importance} BETWEEN 1 AND 5`),
  category: check("memory_review_candidates_category_check", sql`${table.category} IN ('memory', 'anchor', 'milestone', 'anniversary')`),
  evidenceStatus: check("memory_review_candidates_evidence_status_check", sql`${table.evidenceStatus} IN ('verified', 'needs_confirmation', 'confirmed_by_user')`),
  json: check("memory_review_candidates_json_check", sql`jsonb_typeof(${table.evidence}) = 'array' AND jsonb_typeof(${table.keywords}) = 'array'`),
  revision: check("memory_review_candidates_revision_check", sql`${table.revision} > 0`),
  scene: check("memory_review_candidates_scene_check", sql`(${table.kind} = 'story_event' AND ${table.sceneId} IS NOT NULL) OR (${table.kind} <> 'story_event' AND ${table.sceneId} IS NULL)`),
  state: check("memory_review_candidates_state_check", sql`(${table.status} = 'pending' AND ${table.application} = 'pending' AND ${table.memoryId} IS NULL) OR (${table.status} = 'rejected' AND ${table.application} = 'rejected' AND ${table.memoryId} IS NULL) OR (${table.status} = 'accepted' AND ((${table.kind} = 'user_fact' AND ${table.application} = 'memory') OR (${table.kind} IN ('source_fact', 'story_event') AND ${table.application} = 'reviewed_only' AND ${table.memoryId} IS NULL)))`),
}));

export const memoryReviewProvenance = pgTable("memory_review_provenance", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidateId").notNull().references(() => memoryReviewCandidates.id, { onDelete: "cascade" }),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaId: integer("personaId").notNull().references(() => personas.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 24 }).notNull(),
  memoryId: integer("memoryId").references(() => memories.id, { onDelete: "set null" }),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  evidenceStatus: varchar("evidenceStatus", { length: 32 }).notNull(), evidence: jsonb("evidence").notNull(),
  application: varchar("application", { length: 24 }).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  candidateUnique: uniqueIndex("memory_review_provenance_candidate_idx").on(table.candidateId),
  byFact: index("memory_review_provenance_fact_idx").on(table.userId, table.personaId, table.fingerprint),
  byMemory: index("memory_review_provenance_memory_idx").on(table.userId, table.personaId, table.memoryId),
  kind: check("memory_review_provenance_kind_check", sql`${table.kind} IN ('user_fact', 'source_fact', 'story_event')`),
  hash: check("memory_review_provenance_hash_check", sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
  evidenceStatus: check("memory_review_provenance_evidence_status_check", sql`${table.evidenceStatus} IN ('verified', 'needs_confirmation', 'confirmed_by_user')`),
  json: check("memory_review_provenance_json_check", sql`jsonb_typeof(${table.evidence}) = 'array'`),
  application: check("memory_review_provenance_application_check", sql`(${table.application} = 'memory' AND ${table.kind} = 'user_fact') OR (${table.application} = 'reviewed_only' AND ${table.memoryId} IS NULL)`),
}));

export const memoryReviewOperations = pgTable("memory_review_operations", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaId: integer("personaId").notNull().references(() => personas.id, { onDelete: "cascade" }),
  operationId: varchar("operationId", { length: 64 }).notNull(), requestHash: varchar("requestHash", { length: 64 }).notNull(),
  result: jsonb("result").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  operationUnique: uniqueIndex("memory_review_operations_user_key_idx").on(table.userId, table.operationId),
  operationId: check("memory_review_operations_uuid_check", sql`${table.operationId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
  hash: check("memory_review_operations_hash_check", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  json: check("memory_review_operations_json_check", sql`jsonb_typeof(${table.result}) = 'object'`),
}));
