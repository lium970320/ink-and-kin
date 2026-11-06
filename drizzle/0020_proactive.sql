-- mirrai: idempotent-migration

CREATE TABLE IF NOT EXISTS "proactive_policies" (
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "delivery" varchar(8) DEFAULT 'web' NOT NULL,
  "times" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "stylePrompt" text DEFAULT '' NOT NULL,
  "timeZone" varchar(100) NOT NULL,
  "quietHours" varchar(11) NOT NULL,
  "maxPerLocalDay" integer NOT NULL,
  "minIntervalMinutes" integer NOT NULL,
  "ambientEnabled" boolean DEFAULT false NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "qqConfigId" integer,
  "qqGeneration" integer,
  "qqTargetId" varchar(24),
  "updatedAt" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "proactive_policies_pkey" PRIMARY KEY ("userId", "personaId"),
  CONSTRAINT "proactive_policies_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "proactive_policies_personaId_personas_id_fk" FOREIGN KEY ("personaId") REFERENCES "personas" ("id") ON DELETE CASCADE,
  CONSTRAINT "proactive_policies_limits_check" CHECK ("revision" > 0 AND "maxPerLocalDay" BETWEEN 1 AND 10 AND "minIntervalMinutes" BETWEEN 5 AND 1440),
  CONSTRAINT "proactive_policies_times_check" CHECK (CASE WHEN jsonb_typeof("times") = 'array' THEN jsonb_array_length("times") <= 8 ELSE false END),
  CONSTRAINT "proactive_policies_quiet_hours_check" CHECK ("quietHours" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "proactive_policies_delivery_check" CHECK ("delivery" IN ('web', 'qq')),
  CONSTRAINT "proactive_policies_qq_consent_check" CHECK (
    (("qqConfigId" IS NULL AND "qqGeneration" IS NULL AND "qqTargetId" IS NULL)
      OR ("qqConfigId" IS NOT NULL AND "qqConfigId" > 0 AND "qqGeneration" IS NOT NULL AND "qqGeneration" > 0
        AND "qqTargetId" IS NOT NULL AND char_length("qqTargetId") > 0 AND "delivery" = 'qq'))
    AND (NOT "enabled" OR "delivery" <> 'qq' OR "qqConfigId" IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS "proactive_policies_persona_idx" ON "proactive_policies" ("personaId");
CREATE INDEX IF NOT EXISTS "proactive_policies_enabled_idx" ON "proactive_policies" ("userId", "personaId") WHERE "enabled" = true;

CREATE TABLE IF NOT EXISTS "proactive_jobs" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "policyRevision" integer NOT NULL,
  "kind" varchar(12) NOT NULL,
  "triggerKey" varchar(200) NOT NULL,
  "topic" text,
  "dueAt" timestamptz NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "text" text,
  "claimToken" uuid,
  "attemptedAt" timestamptz,
  "localDay" varchar(10),
  "reason" varchar(80),
  "remoteMessageId" varchar(80),
  "settledAt" timestamptz,
  "unknownAcknowledgedAt" timestamptz,
  "cancelRequestedAt" timestamptz,
  "readAt" timestamptz,
  "createdAt" timestamptz DEFAULT now() NOT NULL,
  "updatedAt" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "proactive_jobs_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "proactive_jobs_personaId_personas_id_fk" FOREIGN KEY ("personaId") REFERENCES "personas" ("id") ON DELETE CASCADE,
  CONSTRAINT "proactive_jobs_status_check" CHECK ("status" IN ('pending', 'generating', 'ready', 'confirmed', 'failed', 'unknown', 'cancelled', 'expired')),
  CONSTRAINT "proactive_jobs_kind_check" CHECK ("kind" IN ('scheduled', 'followup', 'ambient')),
  CONSTRAINT "proactive_jobs_bounds_check" CHECK (
    "policyRevision" > 0 AND "dueAt" < "expiresAt" AND char_length("triggerKey") > 0
    AND ("topic" IS NULL OR char_length("topic") <= 500)
    AND ("text" IS NULL OR char_length("text") BETWEEN 1 AND 4000)
  ),
  CONSTRAINT "proactive_jobs_attempt_check" CHECK (
    (("attemptedAt" IS NULL AND "localDay" IS NULL)
      OR ("attemptedAt" IS NOT NULL AND "localDay" IS NOT NULL AND "localDay" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND "claimToken" IS NOT NULL AND "text" IS NOT NULL))
    AND ("attemptedAt" IS NULL OR "status" IN ('unknown', 'confirmed', 'failed'))
    AND ("status" NOT IN ('unknown', 'confirmed') OR "attemptedAt" IS NOT NULL)
    AND ("status" <> 'confirmed' OR "settledAt" IS NOT NULL)
    AND ("settledAt" IS NULL OR "attemptedAt" IS NOT NULL)
    AND ("unknownAcknowledgedAt" IS NULL OR "attemptedAt" IS NOT NULL)
    AND ("cancelRequestedAt" IS NULL OR "attemptedAt" IS NOT NULL)
    AND ("remoteMessageId" IS NULL OR "status" = 'confirmed')
    AND ("status" NOT IN ('generating', 'ready') OR "claimToken" IS NOT NULL)
    AND ("status" <> 'ready' OR "text" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "proactive_jobs_owner_trigger_idx" ON "proactive_jobs" ("userId", "personaId", "triggerKey");
CREATE INDEX IF NOT EXISTS "proactive_jobs_persona_idx" ON "proactive_jobs" ("personaId");
CREATE INDEX IF NOT EXISTS "proactive_jobs_owner_recent_idx" ON "proactive_jobs" ("userId", "personaId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "proactive_jobs_pending_idx" ON "proactive_jobs" ("dueAt", "id") WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "proactive_jobs_expiring_idx" ON "proactive_jobs" ("expiresAt", "id") WHERE "status" IN ('pending', 'generating', 'ready');
CREATE INDEX IF NOT EXISTS "proactive_jobs_attempts_idx" ON "proactive_jobs" ("userId", "personaId", "attemptedAt") WHERE "attemptedAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "proactive_jobs_unknown_idx" ON "proactive_jobs" ("userId", "personaId")
  WHERE "status" = 'unknown' AND "unknownAcknowledgedAt" IS NULL;
