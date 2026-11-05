-- mirrai: idempotent-migration
ALTER TABLE "roleplay_channels"
  ADD COLUMN IF NOT EXISTS "generationRevision" integer NOT NULL DEFAULT 0;
