import { sql } from "drizzle-orm";
import {
  boolean, check, foreignKey, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar,
} from "drizzle-orm/pg-core";
import { personas, users } from "./schema";

export const qqChannelConfigs = pgTable("qq_channel_configs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  hookId: varchar("hookId", { length: 64 }).notNull(),
  apiBaseUrl: text("apiBaseUrl").notNull(),
  botId: varchar("botId", { length: 24 }).notNull(),
  targetId: varchar("targetId", { length: 24 }).notNull(),
  personaId: integer("personaId").references(() => personas.id, { onDelete: "set null" }),
  secretsEnc: text("secretsEnc").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  generation: integer("generation").default(1).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => ({
  owner: uniqueIndex("qq_channel_configs_user_idx").on(table.userId),
  scopedId: uniqueIndex("qq_channel_configs_id_owner_idx").on(table.id, table.userId),
  hook: uniqueIndex("qq_channel_configs_hook_idx").on(table.hookId),
  conversation: uniqueIndex("qq_channel_configs_enabled_target_idx").on(table.botId, table.targetId)
    .where(sql`${table.enabled} = true`),
  generation: check("qq_channel_configs_generation_check", sql`${table.generation} > 0`),
  enabledPersona: check("qq_channel_configs_enabled_persona_check", sql`NOT ${table.enabled} OR ${table.personaId} IS NOT NULL`),
  encrypted: check("qq_channel_configs_secrets_check", sql`${table.secretsEnc} ~ '^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]+={0,2}$'`),
}));

export const qqInboundMessages = pgTable("qq_inbound_messages", {
  id: serial("id").primaryKey(),
  configId: integer("configId").notNull(),
  userId: integer("userId").notNull(),
  configGeneration: integer("configGeneration").notNull(),
  botId: varchar("botId", { length: 24 }).notNull(),
  targetId: varchar("targetId", { length: 24 }).notNull(),
  messageId: varchar("messageId", { length: 80 }).notNull(),
  status: varchar("status", { length: 24 }).default("claimed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  config: foreignKey({
    name: "qq_inbound_messages_config_owner_fk",
    columns: [table.configId, table.userId],
    foreignColumns: [qqChannelConfigs.id, qqChannelConfigs.userId],
  }).onDelete("cascade"),
  message: uniqueIndex("qq_inbound_messages_identity_idx").on(table.configId, table.botId, table.targetId, table.messageId),
  generation: check("qq_inbound_messages_generation_check", sql`${table.configGeneration} > 0`),
  status: check("qq_inbound_messages_status_check", sql`${table.status} IN ('claimed', 'done', 'ignored', 'failed', 'cancelled')`),
}));

export const qqDeliveries = pgTable("qq_deliveries", {
  id: serial("id").primaryKey(),
  configId: integer("configId").notNull(),
  userId: integer("userId").notNull(),
  configGeneration: integer("configGeneration").notNull(),
  botId: varchar("botId", { length: 24 }).notNull(),
  targetId: varchar("targetId", { length: 24 }).notNull(),
  deliveryKey: varchar("deliveryKey", { length: 128 }).notNull(),
  status: varchar("status", { length: 16 }).default("unknown").notNull(),
  remoteMessageId: varchar("remoteMessageId", { length: 80 }),
  reason: varchar("reason", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => ({
  config: foreignKey({
    name: "qq_deliveries_config_owner_fk",
    columns: [table.configId, table.userId],
    foreignColumns: [qqChannelConfigs.id, qqChannelConfigs.userId],
  }).onDelete("cascade"),
  key: uniqueIndex("qq_deliveries_config_key_idx").on(table.configId, table.deliveryKey),
  owner: index("qq_deliveries_owner_idx").on(table.userId, table.createdAt),
  generation: check("qq_deliveries_generation_check", sql`${table.configGeneration} > 0`),
  status: check("qq_deliveries_status_check", sql`${table.status} IN ('confirmed', 'failed', 'unknown')`),
  receipt: check("qq_deliveries_receipt_check", sql`(${table.status} = 'confirmed') = (${table.remoteMessageId} IS NOT NULL)`),
}));
