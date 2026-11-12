import { pgTable, integer, varchar, timestamp, primaryKey, foreignKey, index, text } from "drizzle-orm/pg-core";
import { users, personas } from "./schema";
export type SceneImageJobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
export const sceneImageJobs = pgTable("scene_image_jobs", {
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  id: varchar("id", { length: 36 }).notNull(),
  personaId: integer("personaId"), sceneId: integer("sceneId"),
  contextRevision: integer("contextRevision"), configRevision: integer("configRevision").default(0).notNull(),
  kind: varchar("kind", { length: 16 }).$type<"web" | "qq" | "test" | "cancel">().notNull(),
  status: varchar("status", { length: 16 }).$type<SceneImageJobStatus>().notNull(),
  relayName:varchar("relayName",{length:128}), model:varchar("model",{length:160}), promptText:text("promptText"),
  testMode:varchar("testMode",{length:16}), attempt:integer("attempt").default(0).notNull(),
  relayId: integer("relayId"), referenceMode: varchar("referenceMode", { length: 48 }),
  outputKey: varchar("outputKey", { length: 256 }), messageId: integer("messageId"),
  errorCode: varchar("errorCode", { length: 48 }), durationMs: integer("durationMs"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
}, t => ({ pk: primaryKey({ name:"scene_image_jobs_owner_pk", columns: [t.userId, t.id] }),
  personaOwner: foreignKey({ name:"scene_image_jobs_persona_owner_fk", columns: [t.personaId, t.userId], foreignColumns: [personas.id, personas.userId] }).onDelete("cascade"),
  ownerTime: index("scene_image_jobs_owner_time_idx").on(t.userId, t.createdAt),
}));
