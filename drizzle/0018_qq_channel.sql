-- mirrai: idempotent-migration
ALTER TYPE "channel" ADD VALUE IF NOT EXISTS 'qq';

CREATE TABLE IF NOT EXISTS "qq_channel_configs" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "hookId" varchar(64) NOT NULL,
  "apiBaseUrl" text NOT NULL,
  "botId" varchar(24) NOT NULL,
  "targetId" varchar(24) NOT NULL,
  "personaId" integer REFERENCES "personas"("id") ON DELETE SET NULL,
  "secretsEnc" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "generation" integer DEFAULT 1 NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "qq_channel_configs_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "qq_channel_configs_enabled_persona_check" CHECK (NOT "enabled" OR "personaId" IS NOT NULL),
  CONSTRAINT "qq_channel_configs_secrets_check" CHECK ("secretsEnc" ~ '^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]+={0,2}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "qq_channel_configs_user_idx" ON "qq_channel_configs" ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "qq_channel_configs_id_owner_idx" ON "qq_channel_configs" ("id", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "qq_channel_configs_hook_idx" ON "qq_channel_configs" ("hookId");
CREATE UNIQUE INDEX IF NOT EXISTS "qq_channel_configs_enabled_target_idx" ON "qq_channel_configs" ("botId", "targetId") WHERE "enabled" = true;

CREATE TABLE IF NOT EXISTS "qq_inbound_messages" (
  "id" serial PRIMARY KEY,
  "configId" integer NOT NULL,
  "userId" integer NOT NULL,
  "configGeneration" integer NOT NULL,
  "botId" varchar(24) NOT NULL,
  "targetId" varchar(24) NOT NULL,
  "messageId" varchar(80) NOT NULL,
  "status" varchar(24) DEFAULT 'claimed' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "qq_inbound_messages_config_owner_fk"
    FOREIGN KEY ("configId", "userId") REFERENCES "qq_channel_configs"("id", "userId") ON DELETE CASCADE,
  CONSTRAINT "qq_inbound_messages_generation_check" CHECK ("configGeneration" > 0),
  CONSTRAINT "qq_inbound_messages_status_check" CHECK ("status" IN ('claimed', 'done', 'ignored', 'failed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "qq_inbound_messages_identity_idx" ON "qq_inbound_messages" ("configId", "botId", "targetId", "messageId");

CREATE TABLE IF NOT EXISTS "qq_deliveries" (
  "id" serial PRIMARY KEY,
  "configId" integer NOT NULL,
  "userId" integer NOT NULL,
  "configGeneration" integer NOT NULL,
  "botId" varchar(24) NOT NULL,
  "targetId" varchar(24) NOT NULL,
  "deliveryKey" varchar(128) NOT NULL,
  "status" varchar(16) DEFAULT 'unknown' NOT NULL,
  "remoteMessageId" varchar(80),
  "reason" varchar(80),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "qq_deliveries_config_owner_fk"
    FOREIGN KEY ("configId", "userId") REFERENCES "qq_channel_configs"("id", "userId") ON DELETE CASCADE,
  CONSTRAINT "qq_deliveries_generation_check" CHECK ("configGeneration" > 0),
  CONSTRAINT "qq_deliveries_status_check" CHECK ("status" IN ('confirmed', 'failed', 'unknown')),
  CONSTRAINT "qq_deliveries_receipt_check" CHECK (("status" = 'confirmed') = ("remoteMessageId" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "qq_deliveries_config_key_idx" ON "qq_deliveries" ("configId", "deliveryKey");
CREATE INDEX IF NOT EXISTS "qq_deliveries_owner_idx" ON "qq_deliveries" ("userId", "createdAt");
