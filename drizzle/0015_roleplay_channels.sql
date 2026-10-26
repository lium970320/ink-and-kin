-- Mirrai: 角色频道（roleplay）三表与索引（第 5 批 5A 数据层）
-- mirrai: idempotent-migration
--
-- 对齐自用版 drizzle 迁移里的 roleplay_channels / roleplay_channel_members /
-- roleplay_messages（含后续增量列 channelKind、runtimeDiagnostics、directorState、
-- roleplay_messages.mode）：
--   1. roleplay_channels：频道主体（名称/说明/情景提示/启用状态/来源/运行诊断/导演线）；
--   2. roleplay_channel_members：频道成员（人物、出场顺序、是否发言、已读游标）；
--   3. roleplay_messages：频道消息（角色/用户发言、内心独白、心情、上下文开关、回合类型、模式）。
--
-- 外键沿用本项目新表的做法：账号/人物/频道被删除时由数据库级联清理；
-- server/db.ts 的 deleteUserAccount / deletePersona 同时显式清理，二者互为兜底。
-- 每条语句都写成可重复执行的形式：再次运行不会报错，也不会改动已有数据。

-- ─── roleplay_channels：角色生活频道主体 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "roleplay_channels" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL,
  "description" text,
  "scenePrompt" text,
  "isActive" boolean DEFAULT true NOT NULL,
  "channelKind" varchar(16) DEFAULT 'channel' NOT NULL,
  "runtimeDiagnostics" jsonb,
  "directorState" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "roleplay_channels_user_idx" ON "roleplay_channels" ("userId");

-- ─── roleplay_channel_members：频道成员（人物）与发言顺序 ─────────────────────
CREATE TABLE IF NOT EXISTS "roleplay_channel_members" (
  "id" serial PRIMARY KEY,
  "channelId" integer NOT NULL REFERENCES "roleplay_channels"("id") ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "personaId" integer NOT NULL REFERENCES "personas"("id") ON DELETE CASCADE,
  "displayOrder" integer DEFAULT 0 NOT NULL,
  "speakingEnabled" boolean DEFAULT true NOT NULL,
  "lastReadMessageId" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "roleplay_members_channel_idx" ON "roleplay_channel_members" ("channelId", "displayOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "roleplay_members_channel_persona_idx" ON "roleplay_channel_members" ("channelId", "personaId");

-- ─── roleplay_messages：频道消息（角色发言 / 用户旁白 / 用户插话） ────────────
CREATE TABLE IF NOT EXISTS "roleplay_messages" (
  "id" serial PRIMARY KEY,
  "channelId" integer NOT NULL REFERENCES "roleplay_channels"("id") ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "personaId" integer REFERENCES "personas"("id") ON DELETE CASCADE,
  "speakerName" varchar(100) NOT NULL,
  "role" varchar(32) DEFAULT 'persona' NOT NULL,
  "content" text NOT NULL,
  "innerThought" text,
  "moodState" jsonb,
  "contextOverride" varchar(16) DEFAULT 'auto',
  "turnKind" varchar(50) DEFAULT 'dialogue' NOT NULL,
  "mode" varchar(16) DEFAULT 'channel' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "roleplay_messages_channel_idx" ON "roleplay_messages" ("channelId", "id");
CREATE INDEX IF NOT EXISTS "roleplay_messages_mode_idx" ON "roleplay_messages" ("mode");
