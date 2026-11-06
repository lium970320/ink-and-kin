-- mirrai: idempotent-migration

-- Same-persona ownership must be enforced by the database as well as the API.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'personas'::regclass AND conname = 'personas_id_owner_idx') THEN
    IF to_regclass('personas_id_owner_idx') IS NOT NULL THEN
      ALTER TABLE "personas" ADD CONSTRAINT "personas_id_owner_idx" UNIQUE USING INDEX "personas_id_owner_idx";
    ELSE
      ALTER TABLE "personas" ADD CONSTRAINT "personas_id_owner_idx" UNIQUE ("id", "userId");
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "persona_runtime_states" (
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "status" varchar(200),
  "startedAt" timestamptz,
  "expiresAt" timestamptz,
  "source" varchar(16),
  "revision" integer NOT NULL,
  CONSTRAINT "persona_runtime_states_pkey" PRIMARY KEY ("userId", "personaId"),
  CONSTRAINT "persona_runtime_states_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "persona_runtime_states_persona_owner_fk" FOREIGN KEY ("personaId", "userId")
    REFERENCES "personas" ("id", "userId") ON DELETE CASCADE,
  CONSTRAINT "persona_runtime_states_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "persona_runtime_states_shape_check" CHECK (
    ("status" IS NULL AND "startedAt" IS NULL AND "expiresAt" IS NULL AND "source" IS NULL)
    OR ("status" IS NOT NULL AND length(btrim("status")) > 0
      AND "startedAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "source" IS NOT NULL AND "source" = 'user'
      AND "expiresAt" > "startedAt" AND "expiresAt" <= "startedAt" + interval '24 hours')
  )
);
