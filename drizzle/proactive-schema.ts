import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import type { ProactiveDelivery, ProactiveKind, ProactiveStatus } from "../server/proactive/types";
import { personas, users } from "./schema";

export const proactivePolicies = pgTable("proactive_policies", {
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaId: integer("personaId").notNull().references(() => personas.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(false).notNull(),
  delivery: varchar("delivery", { length: 8 }).$type<ProactiveDelivery>().default("web").notNull(),
  times: jsonb("times").$type<string[]>().default([]).notNull(),
  stylePrompt: text("stylePrompt").default("").notNull(),
  timeZone: varchar("timeZone", { length: 100 }).notNull(),
  quietHours: varchar("quietHours", { length: 11 }).notNull(),
  maxPerLocalDay: integer("maxPerLocalDay").notNull(),
  minIntervalMinutes: integer("minIntervalMinutes").notNull(),
  ambientEnabled: boolean("ambientEnabled").default(false).notNull(),
  revision: integer("revision").default(1).notNull(),
  // These fields describe the exact consent snapshot, not credentials or a live foreign key.
  qqConfigId: integer("qqConfigId"),
  qqGeneration: integer("qqGeneration"),
  qqTargetId: varchar("qqTargetId", { length: 24 }),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  owner: primaryKey({ name: "proactive_policies_pkey", columns: [table.userId, table.personaId] }),
  persona: index("proactive_policies_persona_idx").on(table.personaId),
  enabled: index("proactive_policies_enabled_idx").on(table.userId, table.personaId).where(sql`${table.enabled} = true`),
  limits: check("proactive_policies_limits_check",
    sql`${table.revision} > 0 AND ${table.maxPerLocalDay} BETWEEN 1 AND 10 AND ${table.minIntervalMinutes} BETWEEN 5 AND 1440`),
  times: check("proactive_policies_times_check",
    sql`CASE WHEN jsonb_typeof(${table.times}) = 'array' THEN jsonb_array_length(${table.times}) <= 8 ELSE false END`),
  quiet: check("proactive_policies_quiet_hours_check",
    sql`${table.quietHours} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  delivery: check("proactive_policies_delivery_check", sql`${table.delivery} IN ('web', 'qq')`),
  consent: check("proactive_policies_qq_consent_check", sql`
    ((${table.qqConfigId} IS NULL AND ${table.qqGeneration} IS NULL AND ${table.qqTargetId} IS NULL)
      OR (${table.qqConfigId} IS NOT NULL AND ${table.qqConfigId} > 0
        AND ${table.qqGeneration} IS NOT NULL AND ${table.qqGeneration} > 0
        AND ${table.qqTargetId} IS NOT NULL AND char_length(${table.qqTargetId}) > 0 AND ${table.delivery} = 'qq'))
    AND (NOT ${table.enabled} OR ${table.delivery} <> 'qq' OR ${table.qqConfigId} IS NOT NULL)`),
}));

export const proactiveJobs = pgTable("proactive_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaId: integer("personaId").notNull().references(() => personas.id, { onDelete: "cascade" }),
  policyRevision: integer("policyRevision").notNull(),
  kind: varchar("kind", { length: 12 }).$type<ProactiveKind>().notNull(),
  triggerKey: varchar("triggerKey", { length: 200 }).notNull(),
  topic: text("topic"),
  dueAt: timestamp("dueAt", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 12 }).$type<ProactiveStatus>().default("pending").notNull(),
  text: text("text"),
  claimToken: uuid("claimToken"),
  attemptedAt: timestamp("attemptedAt", { withTimezone: true }),
  localDay: varchar("localDay", { length: 10 }),
  reason: varchar("reason", { length: 80 }),
  remoteMessageId: varchar("remoteMessageId", { length: 80 }),
  settledAt: timestamp("settledAt", { withTimezone: true }),
  unknownAcknowledgedAt: timestamp("unknownAcknowledgedAt", { withTimezone: true }),
  cancelRequestedAt: timestamp("cancelRequestedAt", { withTimezone: true }),
  readAt: timestamp("readAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  trigger: uniqueIndex("proactive_jobs_owner_trigger_idx").on(table.userId, table.personaId, table.triggerKey),
  persona: index("proactive_jobs_persona_idx").on(table.personaId),
  recent: index("proactive_jobs_owner_recent_idx").on(table.userId, table.personaId, table.createdAt, table.id),
  pending: index("proactive_jobs_pending_idx").on(table.dueAt, table.id).where(sql`${table.status} = 'pending'`),
  expiring: index("proactive_jobs_expiring_idx").on(table.expiresAt, table.id)
    .where(sql`${table.status} IN ('pending', 'generating', 'ready')`),
  attempts: index("proactive_jobs_attempts_idx").on(table.userId, table.personaId, table.attemptedAt)
    .where(sql`${table.attemptedAt} IS NOT NULL`),
  unresolved: index("proactive_jobs_unknown_idx").on(table.userId, table.personaId)
    .where(sql`${table.status} = 'unknown' AND ${table.unknownAcknowledgedAt} IS NULL`),
  status: check("proactive_jobs_status_check",
    sql`${table.status} IN ('pending', 'generating', 'ready', 'confirmed', 'failed', 'unknown', 'cancelled', 'expired')`),
  kind: check("proactive_jobs_kind_check", sql`${table.kind} IN ('scheduled', 'followup', 'ambient')`),
  bounds: check("proactive_jobs_bounds_check",
    sql`${table.policyRevision} > 0 AND ${table.dueAt} < ${table.expiresAt} AND char_length(${table.triggerKey}) > 0
      AND (${table.topic} IS NULL OR char_length(${table.topic}) <= 500)
      AND (${table.text} IS NULL OR char_length(${table.text}) BETWEEN 1 AND 4000)`),
  attempt: check("proactive_jobs_attempt_check", sql`
    ((${table.attemptedAt} IS NULL AND ${table.localDay} IS NULL)
      OR (${table.attemptedAt} IS NOT NULL AND ${table.localDay} IS NOT NULL
        AND ${table.localDay} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND ${table.claimToken} IS NOT NULL AND ${table.text} IS NOT NULL))
    AND (${table.attemptedAt} IS NULL OR ${table.status} IN ('unknown', 'confirmed', 'failed'))
    AND (${table.status} NOT IN ('unknown', 'confirmed') OR ${table.attemptedAt} IS NOT NULL)
    AND (${table.status} <> 'confirmed' OR ${table.settledAt} IS NOT NULL)
    AND (${table.settledAt} IS NULL OR ${table.attemptedAt} IS NOT NULL)
    AND (${table.unknownAcknowledgedAt} IS NULL OR ${table.attemptedAt} IS NOT NULL)
    AND (${table.cancelRequestedAt} IS NULL OR ${table.attemptedAt} IS NOT NULL)
    AND (${table.remoteMessageId} IS NULL OR ${table.status} = 'confirmed')
    AND (${table.status} NOT IN ('generating', 'ready') OR ${table.claimToken} IS NOT NULL)
    AND (${table.status} <> 'ready' OR ${table.text} IS NOT NULL)`),
}));
