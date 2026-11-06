import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { roleplayChannels } from "./schema";
import { qqChannelConfigs } from "./qq-channel-schema";

export type QqRoleplayRetryOperation = {
  operationId: string;
  expectedVersion: number;
  allowUnknown: boolean;
};
export type QqRoleplayStoredPartStatus = "pending" | "sent" | "failed" | "unknown" | "cancelled";

export const qqRoleplayRoutes = pgTable("qq_roleplay_routes", {
  userId: integer("userId").primaryKey(),
  configId: integer("configId").notNull(),
  configGeneration: integer("configGeneration").notNull(),
  botId: varchar("botId", { length: 24 }).notNull(),
  targetId: varchar("targetId", { length: 24 }).notNull(),
  // Keep the revision after channel deletion so an old no-route snapshot cannot become current again.
  channelId: integer("channelId").references(() => roleplayChannels.id, { onDelete: "set null" }),
  routeRevision: integer("routeRevision").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => ({
  config: foreignKey({
    name: "qq_roleplay_routes_config_owner_fk",
    columns: [table.configId, table.userId],
    foreignColumns: [qqChannelConfigs.id, qqChannelConfigs.userId],
  }).onDelete("cascade"),
  channel: index("qq_roleplay_routes_channel_idx").on(table.channelId),
  revisions: check("qq_roleplay_routes_revisions_check", sql`${table.configGeneration} > 0 AND ${table.routeRevision} > 0`),
}));

export const qqRoleplayBatches = pgTable("qq_roleplay_batches", {
  id: uuid("id").primaryKey(),
  userId: integer("userId").notNull(),
  configId: integer("configId").notNull(),
  configGeneration: integer("configGeneration").notNull(),
  botId: varchar("botId", { length: 24 }).notNull(),
  targetId: varchar("targetId", { length: 24 }).notNull(),
  channelId: integer("channelId").notNull().references(() => roleplayChannels.id, { onDelete: "cascade" }),
  routeRevision: integer("routeRevision").notNull(),
  originalChannelRevision: integer("originalChannelRevision").notNull(),
  // Explicit retry may renew this authorization; originalChannelRevision stays fixed.
  channelRevision: integer("channelRevision").notNull(),
  operationId: uuid("operationId").notNull(),
  activeOperationId: uuid("activeOperationId").notNull(),
  // Channel messages can be deleted independently; immutable delivery history keeps the old ID.
  messageId: integer("messageId").notNull(),
  beatIndex: integer("beatIndex").notNull(),
  source: varchar("source", { length: 8 }).$type<"web" | "qq">().notNull(),
  version: integer("version").default(1).notNull(),
  retryOperations: jsonb("retryOperations").$type<QqRoleplayRetryOperation[]>().default([]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => ({
  config: foreignKey({
    name: "qq_roleplay_batches_config_owner_fk",
    columns: [table.configId, table.userId],
    foreignColumns: [qqChannelConfigs.id, qqChannelConfigs.userId],
  }).onDelete("cascade"),
  operation: uniqueIndex("qq_roleplay_batches_operation_message_idx")
    .on(table.userId, table.channelId, table.operationId, table.messageId),
  channel: index("qq_roleplay_batches_channel_recent_idx").on(table.channelId, table.userId, table.createdAt, table.id),
  configOwner: index("qq_roleplay_batches_config_owner_idx").on(table.configId, table.userId),
  revisions: check("qq_roleplay_batches_revisions_check",
    sql`${table.configGeneration} > 0 AND ${table.routeRevision} > 0 AND ${table.originalChannelRevision} >= 0 AND ${table.channelRevision} >= 0 AND ${table.version} > 0`),
  message: check("qq_roleplay_batches_message_check", sql`${table.messageId} > 0 AND ${table.beatIndex} >= 0`),
  source: check("qq_roleplay_batches_source_check", sql`${table.source} IN ('qq', 'web')`),
  retries: check("qq_roleplay_batches_retry_operations_check",
    sql`CASE WHEN jsonb_typeof(${table.retryOperations}) = 'array' THEN jsonb_array_length(${table.retryOperations}) <= 100 ELSE false END`),
}));

export const qqRoleplayParts = pgTable("qq_roleplay_parts", {
  id: uuid("id").primaryKey(),
  batchId: uuid("batchId").notNull().references(() => qqRoleplayBatches.id, { onDelete: "cascade" }),
  partIndex: integer("partIndex").notNull(),
  text: text("text").notNull(),
  status: varchar("status", { length: 12 }).$type<QqRoleplayStoredPartStatus>().default("pending").notNull(),
  attemptCount: integer("attemptCount").default(0).notNull(),
  duplicateRisk: boolean("duplicateRisk").default(false).notNull(),
  qqMessageId: varchar("qqMessageId", { length: 80 }),
  error: varchar("error", { length: 80 }),
}, table => ({
  order: uniqueIndex("qq_roleplay_parts_batch_order_idx").on(table.batchId, table.partIndex),
  bounds: check("qq_roleplay_parts_bounds_check",
    sql`${table.partIndex} >= 0 AND ${table.partIndex} < 32 AND char_length(${table.text}) BETWEEN 1 AND 4000 AND ${table.attemptCount} >= 0`),
  status: check("qq_roleplay_parts_status_check",
    sql`${table.status} IN ('pending', 'sent', 'failed', 'unknown', 'cancelled')`),
  receipt: check("qq_roleplay_parts_receipt_check", sql`(${table.status} = 'sent') = (${table.qqMessageId} IS NOT NULL)`),
}));

export const qqRoleplayAttempts = pgTable("qq_roleplay_attempts", {
  id: uuid("id").primaryKey(),
  partId: uuid("partId").notNull().references(() => qqRoleplayParts.id, { onDelete: "cascade" }),
  operationId: uuid("operationId").notNull(),
  status: varchar("status", { length: 12 }).$type<"confirmed" | "failed" | "unknown">().default("unknown").notNull(),
  remoteMessageId: varchar("remoteMessageId", { length: 80 }),
  reason: varchar("reason", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  dispatchedAt: timestamp("dispatchedAt"),
  settledAt: timestamp("settledAt"),
}, table => ({
  operation: uniqueIndex("qq_roleplay_attempts_part_operation_idx").on(table.partId, table.operationId),
  status: check("qq_roleplay_attempts_status_check", sql`${table.status} IN ('confirmed', 'failed', 'unknown')`),
  receipt: check("qq_roleplay_attempts_receipt_check",
    sql`(${table.status} = 'confirmed') = (${table.remoteMessageId} IS NOT NULL) AND (${table.status} <> 'confirmed' OR ${table.dispatchedAt} IS NOT NULL)`),
  settlement: check("qq_roleplay_attempts_settlement_check",
    sql`(${table.settledAt} IS NULL AND ${table.status} = 'unknown' AND ${table.reason} IS NULL) OR (${table.settledAt} IS NOT NULL AND ${table.reason} IS NOT NULL)`),
}));
