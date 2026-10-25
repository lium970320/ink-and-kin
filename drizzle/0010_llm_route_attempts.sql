-- mirrai: idempotent-migration
ALTER TABLE "llm_usage_records" ADD COLUMN IF NOT EXISTS "attemptedProviders" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "llm_usage_records" ADD COLUMN IF NOT EXISTS "attemptedRelayIds" jsonb DEFAULT '[]'::jsonb NOT NULL;
