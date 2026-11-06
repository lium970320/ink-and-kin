-- mirrai: idempotent-migration

-- 新装时复合外键须在独立索引创建前就有唯一约束；升级复用既有唯一索引。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'qq_channel_configs'::regclass AND conname = 'qq_channel_configs_id_owner_idx') THEN
    ALTER TABLE "qq_channel_configs" ADD CONSTRAINT "qq_channel_configs_id_owner_idx"
      UNIQUE USING INDEX "qq_channel_configs_id_owner_idx";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "qq_roleplay_routes" (
  "userId" integer PRIMARY KEY,
  "configId" integer NOT NULL,
  "configGeneration" integer NOT NULL,
  "botId" varchar(24) NOT NULL,
  "targetId" varchar(24) NOT NULL,
  "channelId" integer,
  "routeRevision" integer NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "qq_roleplay_routes_config_owner_fk" FOREIGN KEY ("configId", "userId")
    REFERENCES "qq_channel_configs" ("id", "userId") ON DELETE CASCADE,
  CONSTRAINT "qq_roleplay_routes_channelId_roleplay_channels_id_fk" FOREIGN KEY ("channelId")
    REFERENCES "roleplay_channels" ("id") ON DELETE SET NULL,
  CONSTRAINT "qq_roleplay_routes_revisions_check" CHECK ("configGeneration" > 0 AND "routeRevision" > 0)
);
CREATE INDEX IF NOT EXISTS "qq_roleplay_routes_channel_idx" ON "qq_roleplay_routes" ("channelId");

CREATE TABLE IF NOT EXISTS "qq_roleplay_batches" (
  "id" uuid PRIMARY KEY,
  "userId" integer NOT NULL,
  "configId" integer NOT NULL,
  "configGeneration" integer NOT NULL,
  "botId" varchar(24) NOT NULL,
  "targetId" varchar(24) NOT NULL,
  "channelId" integer NOT NULL,
  "routeRevision" integer NOT NULL,
  "originalChannelRevision" integer NOT NULL,
  "channelRevision" integer NOT NULL,
  "operationId" uuid NOT NULL,
  "activeOperationId" uuid NOT NULL,
  "messageId" integer NOT NULL,
  "beatIndex" integer NOT NULL,
  "source" varchar(8) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "retryOperations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "qq_roleplay_batches_config_owner_fk" FOREIGN KEY ("configId", "userId")
    REFERENCES "qq_channel_configs" ("id", "userId") ON DELETE CASCADE,
  CONSTRAINT "qq_roleplay_batches_channelId_roleplay_channels_id_fk" FOREIGN KEY ("channelId")
    REFERENCES "roleplay_channels" ("id") ON DELETE CASCADE,
  CONSTRAINT "qq_roleplay_batches_revisions_check"
    CHECK ("configGeneration" > 0 AND "routeRevision" > 0 AND "originalChannelRevision" >= 0 AND "channelRevision" >= 0 AND "version" > 0),
  CONSTRAINT "qq_roleplay_batches_message_check" CHECK ("messageId" > 0 AND "beatIndex" >= 0),
  CONSTRAINT "qq_roleplay_batches_source_check" CHECK ("source" IN ('qq', 'web')),
  CONSTRAINT "qq_roleplay_batches_retry_operations_check"
    CHECK (CASE WHEN jsonb_typeof("retryOperations") = 'array' THEN jsonb_array_length("retryOperations") <= 100 ELSE false END)
);
CREATE UNIQUE INDEX IF NOT EXISTS "qq_roleplay_batches_operation_message_idx"
  ON "qq_roleplay_batches" ("userId", "channelId", "operationId", "messageId");
CREATE INDEX IF NOT EXISTS "qq_roleplay_batches_channel_recent_idx"
  ON "qq_roleplay_batches" ("channelId", "userId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "qq_roleplay_batches_config_owner_idx"
  ON "qq_roleplay_batches" ("configId", "userId");

CREATE TABLE IF NOT EXISTS "qq_roleplay_parts" (
  "id" uuid PRIMARY KEY,
  "batchId" uuid NOT NULL,
  "partIndex" integer NOT NULL,
  "text" text NOT NULL,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "attemptCount" integer DEFAULT 0 NOT NULL,
  "duplicateRisk" boolean DEFAULT false NOT NULL,
  "qqMessageId" varchar(80),
  "error" varchar(80),
  CONSTRAINT "qq_roleplay_parts_batchId_qq_roleplay_batches_id_fk" FOREIGN KEY ("batchId")
    REFERENCES "qq_roleplay_batches" ("id") ON DELETE CASCADE,
  CONSTRAINT "qq_roleplay_parts_bounds_check"
    CHECK ("partIndex" >= 0 AND "partIndex" < 32 AND char_length("text") BETWEEN 1 AND 4000 AND "attemptCount" >= 0),
  CONSTRAINT "qq_roleplay_parts_status_check" CHECK ("status" IN ('pending', 'sent', 'failed', 'unknown', 'cancelled')),
  CONSTRAINT "qq_roleplay_parts_receipt_check" CHECK (("status" = 'sent') = ("qqMessageId" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "qq_roleplay_parts_batch_order_idx" ON "qq_roleplay_parts" ("batchId", "partIndex");

CREATE TABLE IF NOT EXISTS "qq_roleplay_attempts" (
  "id" uuid PRIMARY KEY,
  "partId" uuid NOT NULL,
  "operationId" uuid NOT NULL,
  "status" varchar(12) DEFAULT 'unknown' NOT NULL,
  "remoteMessageId" varchar(80),
  "reason" varchar(80),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "dispatchedAt" timestamp,
  "settledAt" timestamp,
  CONSTRAINT "qq_roleplay_attempts_partId_qq_roleplay_parts_id_fk" FOREIGN KEY ("partId")
    REFERENCES "qq_roleplay_parts" ("id") ON DELETE CASCADE,
  CONSTRAINT "qq_roleplay_attempts_status_check" CHECK ("status" IN ('confirmed', 'failed', 'unknown')),
  CONSTRAINT "qq_roleplay_attempts_receipt_check"
    CHECK (("status" = 'confirmed') = ("remoteMessageId" IS NOT NULL) AND ("status" <> 'confirmed' OR "dispatchedAt" IS NOT NULL)),
  CONSTRAINT "qq_roleplay_attempts_settlement_check"
    CHECK (("settledAt" IS NULL AND "status" = 'unknown' AND "reason" IS NULL) OR ("settledAt" IS NOT NULL AND "reason" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "qq_roleplay_attempts_part_operation_idx" ON "qq_roleplay_attempts" ("partId", "operationId");
