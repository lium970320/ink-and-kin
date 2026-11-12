import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import type { SceneImageSettings, StoredSceneImageRelay } from "../server/scene-image/config";
import { users } from "./schema";

export const sceneImageConfigs = pgTable("scene_image_configs", {
  userId: integer("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<SceneImageSettings>().notNull(),
  relays: jsonb("relays").$type<StoredSceneImageRelay[]>().default([]).notNull(),
  revision: integer("revision").notNull(),
  nextRelayId: integer("nextRelayId").default(1).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  version: check("scene_image_configs_version_check", sql`${table.revision} > 0 AND ${table.nextRelayId} > 0`),
  settingsShape: check("scene_image_configs_settings_check", sql`jsonb_typeof(${table.settings}) = 'object'`),
  relayShape: check("scene_image_configs_relays_check", sql`CASE WHEN jsonb_typeof(${table.relays}) = 'array'
    THEN jsonb_array_length(${table.relays}) <= 24 AND NOT jsonb_path_exists(${table.relays}, '$[*].apiKey') ELSE false END`),
}));
