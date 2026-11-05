-- mirrai: idempotent-migration
-- 保留升级前已隐藏的场景历史；升级后日常和每个场景独立维护起点。
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'scene_memory_states'::regclass
      AND attname = 'startAfterMessageId' AND NOT attisdropped
  ) THEN
    ALTER TABLE "scene_memory_states"
      ADD COLUMN "startAfterMessageId" integer DEFAULT 0 NOT NULL;

    UPDATE "scene_memory_states" AS state
    SET "startAfterMessageId" = daily."startAfterMessageId"
    FROM "chat_context_states" AS daily
    WHERE state."personaId" = daily."personaId"
      AND state."userId" = daily."userId"
      AND daily."startAfterMessageId" > 0;

    INSERT INTO "scene_memory_states" ("personaId", "userId", "sceneId", "startAfterMessageId")
    SELECT DISTINCT msg."personaId", msg."userId", msg."sceneId", daily."startAfterMessageId"
    FROM "messages" AS msg
    JOIN "chat_context_states" AS daily
      ON daily."personaId" = msg."personaId" AND daily."userId" = msg."userId"
    JOIN "personas" AS persona
      ON persona."id" = msg."personaId" AND persona."userId" = msg."userId"
    JOIN "scenes" AS scene
      ON scene."id" = msg."sceneId" AND (scene."isBuiltin" OR scene."userId" = msg."userId")
    WHERE msg."mode" = 'scene' AND daily."startAfterMessageId" > 0
    ON CONFLICT ("personaId", "userId", "sceneId") DO NOTHING;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'scene_memory_states'::regclass
      AND conname = 'scene_memory_states_sceneId_scenes_id_fk'
  ) THEN
    -- 只移除指向已删除场景的旧缓存，原始消息仍留作历史。
    DELETE FROM "scene_memory_states" AS state
    WHERE NOT EXISTS (SELECT 1 FROM "scenes" AS scene WHERE scene."id" = state."sceneId");
    ALTER TABLE "scene_memory_states"
      ADD CONSTRAINT "scene_memory_states_sceneId_scenes_id_fk"
      FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE CASCADE;
  END IF;
END;
$migration$;
