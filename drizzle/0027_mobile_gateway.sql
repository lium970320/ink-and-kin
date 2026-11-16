-- mirrai: idempotent-migration
ALTER TYPE "public"."channel" ADD VALUE IF NOT EXISTS 'mobile';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mobile_devices" (
  "id" uuid PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "deviceName" varchar(100) NOT NULL,
  "tokenHash" varchar(64) NOT NULL CONSTRAINT "mobile_devices_tokenHash_unique" UNIQUE,
  "tokenVersion" integer NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "lastSeenAt" timestamp with time zone NOT NULL DEFAULT now(),
  "expiresAt" timestamp with time zone NOT NULL,
  "revokedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_devices_user_idx" ON "mobile_devices" ("userId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mobile_settings" (
  "userId" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "proactiveTargetMode" varchar(20) NOT NULL DEFAULT 'qq_first',
  CONSTRAINT "mobile_settings_mode_check" CHECK ("proactiveTargetMode" IN ('mobile_first', 'both', 'qq_first', 'mobile_only', 'qq_only'))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "clientMessageId" uuid;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "replyToMessageId" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_client_message_idx"
  ON "messages" ("userId", "personaId", "clientMessageId") WHERE "clientMessageId" IS NOT NULL;
