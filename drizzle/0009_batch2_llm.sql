-- mirrai: idempotent-migration
-- Provider credentials stay encrypted; their envelope may exceed the plaintext limit.
ALTER TABLE "llm_configs" ALTER COLUMN "apiKey" TYPE text;
UPDATE "llm_configs" SET "providerName" = btrim("providerName");
-- Existing ambiguous duplicates intentionally fail these constraints rather than discard credentials.
CREATE UNIQUE INDEX IF NOT EXISTS "llm_configs_user_provider_idx" ON "llm_configs" ("userId", lower(btrim("providerName")));
CREATE UNIQUE INDEX IF NOT EXISTS "llm_configs_user_default_idx" ON "llm_configs" ("userId") WHERE "isDefault" = true;
CREATE TABLE IF NOT EXISTS "llm_provider_relays" (
  "id" serial PRIMARY KEY,
  "llmConfigId" integer NOT NULL REFERENCES "llm_configs"("id") ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "relayName" varchar(128) NOT NULL, "priority" integer DEFAULT 100 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL, "apiKey" text, "apiKeyHint" varchar(16),
  "baseUrl" varchar(512), "model" varchar(128), "reasoningEffort" varchar(16), "extraConfig" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL, "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "llm_provider_relays_owner_idx" ON "llm_provider_relays" ("userId", "llmConfigId", "enabled", "priority");
-- Explicit, atomic legacy conversion. Ciphertext is copied without decryption.
-- Only configurations without a station are converted; a second migration run is a no-op.
WITH moved AS (
  INSERT INTO "llm_provider_relays" ("llmConfigId", "userId", "relayName", "priority", "enabled", "apiKey", "apiKeyHint", "baseUrl", "model")
  SELECT config."id", config."userId", '默认中转站', 100, true, config."apiKey", config."apiKeyHint", config."baseUrl", config."model"
  FROM "llm_configs" AS config
  WHERE (NULLIF(BTRIM(config."apiKey"), '') IS NOT NULL OR NULLIF(BTRIM(config."baseUrl"), '') IS NOT NULL OR NULLIF(BTRIM(config."model"), '') IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM "llm_provider_relays" AS relay WHERE relay."llmConfigId" = config."id")
  RETURNING "llmConfigId"
)
UPDATE "llm_configs" SET "apiKey" = NULL, "apiKeyHint" = NULL, "baseUrl" = NULL, "model" = NULL
WHERE "id" IN (SELECT "llmConfigId" FROM moved);
-- No getter migrates parent keys or changes provider configuration as a read side effect.
CREATE TABLE IF NOT EXISTS "llm_usage_records" (
  "id" serial PRIMARY KEY, "startedAt" timestamp NOT NULL, "durationMs" integer DEFAULT 0 NOT NULL,
  "provider" varchar(64) NOT NULL, "requestedProvider" varchar(64), "model" varchar(128), "reasoningEffort" varchar(32),
  "purpose" varchar(64), "route" varchar(128),
  "userId" integer REFERENCES "users"("id") ON DELETE CASCADE,
  "personaId" integer REFERENCES "personas"("id") ON DELETE SET NULL,
  "relayId" integer REFERENCES "llm_provider_relays"("id") ON DELETE SET NULL,
  "success" boolean DEFAULT true NOT NULL, "status" varchar(16) DEFAULT 'success' NOT NULL, "attempts" integer DEFAULT 1 NOT NULL,
  "streaming" boolean DEFAULT false NOT NULL,
  "inputTokens" integer DEFAULT 0 NOT NULL, "outputTokens" integer DEFAULT 0 NOT NULL, "totalTokens" integer DEFAULT 0 NOT NULL,
  "inputChars" integer DEFAULT 0 NOT NULL, "outputChars" integer DEFAULT 0 NOT NULL,
  "usageSource" varchar(16) DEFAULT 'estimated' NOT NULL, "inputSource" varchar(16) DEFAULT 'estimated' NOT NULL,
  "outputSource" varchar(16) DEFAULT 'estimated' NOT NULL, "totalSource" varchar(16) DEFAULT 'estimated' NOT NULL,
  "error" text, "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "llm_usage_records_status_check" CHECK ("status" IN ('success', 'failed', 'cancelled')),
  CONSTRAINT "llm_usage_records_source_check" CHECK ("usageSource" IN ('provider', 'estimated', 'mixed') AND "inputSource" IN ('provider', 'estimated', 'mixed') AND "outputSource" IN ('provider', 'estimated', 'mixed') AND "totalSource" IN ('provider', 'estimated', 'mixed'))
);
CREATE INDEX IF NOT EXISTS "llm_usage_records_owner_started_idx" ON "llm_usage_records" ("userId", "startedAt", "id");
