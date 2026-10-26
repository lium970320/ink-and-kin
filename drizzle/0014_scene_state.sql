-- Mirrai: 场景状态列、消息场景归属与场景记忆缓存表（第 4 批 4A 数据层）
-- mirrai: idempotent-migration
--
-- 对齐自用版 drizzle/0013_scene_identity_overrides.sql、0020_scene_memory_states.sql、
-- 0021_scene_image_assets.sql、0022_scene_user_ref_key.sql 与 0012_message_context_override.sql：
--   1. scenes 补齐场景模式需要的身份覆盖、前情提要、续写开关与配图资产列；
--   2. messages 补齐上下文强制开关、场景归属与消息模式；
--   3. 新建 scene_memory_states：按 (personaId, userId, sceneId) 保存场景剧情记忆，
--      本批只建表，读写函数由 4B 实现。
--
-- 每条语句都写成可重复执行的形式：再次运行不会报错，也不会改动已有数据。

-- ─── scenes：场景模式的身份与配图状态 ────────────────────────────────────────
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "personaIdentityOverride" text;
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "userIdentityOverride" text;
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "contextSeed" text;
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "continuationEnabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "scenePersonaRefKey" text;
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "sceneUserRefKey" text;
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "sceneEnvRefKey" text;
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "sceneVisualBaseline" text;

-- ─── messages：场景消息归属与上下文开关 ──────────────────────────────────────
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "contextOverride" boolean;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sceneId" integer;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "mode" varchar(16) DEFAULT 'daily' NOT NULL;
CREATE INDEX IF NOT EXISTS "messages_persona_scene_idx" ON "messages" ("personaId", "sceneId", "id");

-- ─── scene_memory_states：场景剧情记忆缓存区 ─────────────────────────────────
-- 外键沿用本项目新表的做法：账号/分身被删除时由数据库级联清理，
-- 场景删除则由 deleteScene 显式清理（与自用版一致）。
CREATE TABLE IF NOT EXISTS "scene_memory_states" (
  "id" serial PRIMARY KEY,
  "personaId" integer NOT NULL REFERENCES "personas"("id") ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sceneId" integer NOT NULL,
  "storyState" jsonb,
  "cache" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "scene_memory_states_persona_user_scene_idx" ON "scene_memory_states" ("personaId", "userId", "sceneId");
CREATE INDEX IF NOT EXISTS "scene_memory_states_user_idx" ON "scene_memory_states" ("userId");
CREATE INDEX IF NOT EXISTS "scene_memory_states_scene_idx" ON "scene_memory_states" ("sceneId");
