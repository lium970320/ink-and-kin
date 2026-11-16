import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import type { ProactiveTargetMode } from "../shared/mobile";
import { users } from "./schema";

export const mobileDevices = pgTable("mobile_devices", {
  id: uuid("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceName: varchar("deviceName", { length: 100 }).notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  tokenVersion: integer("tokenVersion").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revokedAt", { withTimezone: true }),
}, table => ({
  owner: index("mobile_devices_user_idx").on(table.userId),
}));

export const mobileSettings = pgTable("mobile_settings", {
  userId: integer("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  proactiveTargetMode: varchar("proactiveTargetMode", { length: 20 })
    .$type<ProactiveTargetMode>().default("qq_first").notNull(),
}, table => ({
  mode: check("mobile_settings_mode_check",
    sql`${table.proactiveTargetMode} IN ('mobile_first', 'both', 'qq_first', 'mobile_only', 'qq_only')`),
}));
