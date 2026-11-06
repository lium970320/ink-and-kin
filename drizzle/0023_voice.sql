-- mirrai: idempotent-migration

CREATE TABLE IF NOT EXISTS "voice_configs" (
  "userId" integer PRIMARY KEY,
  "asrEnabled" boolean DEFAULT false NOT NULL,
  "baseUrl" text DEFAULT '' NOT NULL,
  "model" varchar(160) DEFAULT '' NOT NULL,
  "timeoutMs" integer DEFAULT 60000 NOT NULL,
  "ttsEnabled" boolean DEFAULT true NOT NULL,
  "apiKeyEnc" text,
  "revision" integer DEFAULT 1 NOT NULL,
  "updatedAt" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "voice_configs_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "voice_configs_limits_check"
    CHECK ("revision" > 0 AND "timeoutMs" BETWEEN 1000 AND 120000 AND char_length("baseUrl") <= 2000),
  CONSTRAINT "voice_configs_asr_ready_check"
    CHECK (NOT "asrEnabled" OR (char_length("baseUrl") > 0 AND char_length("model") > 0 AND "apiKeyEnc" IS NOT NULL)),
  CONSTRAINT "voice_configs_key_encrypted_check"
    CHECK ("apiKeyEnc" IS NULL OR "apiKeyEnc" ~ '^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]+={0,2}$')
);
