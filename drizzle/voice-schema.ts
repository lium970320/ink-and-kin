import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { users } from "./schema";

export const voiceConfigs = pgTable("voice_configs", {
  userId: integer("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  asrEnabled: boolean("asrEnabled").default(false).notNull(),
  baseUrl: text("baseUrl").default("").notNull(),
  model: varchar("model", { length: 160 }).default("").notNull(),
  timeoutMs: integer("timeoutMs").default(60_000).notNull(),
  ttsEnabled: boolean("ttsEnabled").default(true).notNull(),
  apiKeyEnc: text("apiKeyEnc"),
  revision: integer("revision").default(1).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  limits: check("voice_configs_limits_check",
    sql`${table.revision} > 0 AND ${table.timeoutMs} BETWEEN 1000 AND 120000 AND char_length(${table.baseUrl}) <= 2000`),
  ready: check("voice_configs_asr_ready_check",
    sql`NOT ${table.asrEnabled} OR (char_length(${table.baseUrl}) > 0 AND char_length(${table.model}) > 0 AND ${table.apiKeyEnc} IS NOT NULL)`),
  encrypted: check("voice_configs_key_encrypted_check",
    sql`${table.apiKeyEnc} IS NULL OR ${table.apiKeyEnc} ~ '^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]+={0,2}$'`),
}));
