import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";
import { personas, users } from "./schema";

/** 清空状态保留版本号，以免旧页面在清空后重放写入。 */
export const personaRuntimeStates = pgTable("persona_runtime_states", {
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaId: integer("personaId").notNull(),
  status: varchar("status", { length: 200 }),
  startedAt: timestamp("startedAt", { withTimezone: true }),
  expiresAt: timestamp("expiresAt", { withTimezone: true }),
  source: varchar("source", { length: 16, enum: ["user"] }),
  revision: integer("revision").notNull(),
}, table => ({
  identity: primaryKey({ name: "persona_runtime_states_pkey", columns: [table.userId, table.personaId] }),
  personaOwner: foreignKey({
    name: "persona_runtime_states_persona_owner_fk",
    columns: [table.personaId, table.userId],
    foreignColumns: [personas.id, personas.userId],
  }).onDelete("cascade"),
  revision: check("persona_runtime_states_revision_check", sql`${table.revision} > 0`),
  shape: check("persona_runtime_states_shape_check", sql`
    (${table.status} IS NULL AND ${table.startedAt} IS NULL AND ${table.expiresAt} IS NULL AND ${table.source} IS NULL)
    OR (${table.status} IS NOT NULL AND length(btrim(${table.status})) > 0
      AND ${table.startedAt} IS NOT NULL AND ${table.expiresAt} IS NOT NULL
      AND ${table.source} IS NOT NULL AND ${table.source} = 'user'
      AND ${table.expiresAt} > ${table.startedAt} AND ${table.expiresAt} <= ${table.startedAt} + interval '24 hours')
  `),
}));

export type PersonaRuntimeStateRow = typeof personaRuntimeStates.$inferSelect;
