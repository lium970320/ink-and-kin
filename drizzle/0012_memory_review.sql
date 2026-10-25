-- mirrai: idempotent-migration
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "source" varchar(24) DEFAULT 'manual' NOT NULL;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "memoryType" varchar(40) DEFAULT 'relationship_event' NOT NULL;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "confidence" integer DEFAULT 3 NOT NULL;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "emotion" varchar(120);
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "status" varchar(16) DEFAULT 'active' NOT NULL;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 1 NOT NULL;

CREATE TABLE IF NOT EXISTS "memory_review_candidates" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "personaId" integer NOT NULL REFERENCES "personas"("id") ON DELETE CASCADE,
  "kind" varchar(24) NOT NULL, "title" varchar(200) NOT NULL, "description" text NOT NULL,
  "confidence" integer DEFAULT 3 NOT NULL, "importance" integer DEFAULT 3 NOT NULL,
  "source" varchar(24) DEFAULT 'chat' NOT NULL, "memoryType" varchar(40) DEFAULT 'relationship_event' NOT NULL,
  "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL, "emotion" varchar(120) DEFAULT '' NOT NULL,
  "sceneId" integer REFERENCES "scenes"("id") ON DELETE CASCADE, "factKey" varchar(120), "date" varchar(50),
  "category" varchar(24) DEFAULT 'memory' NOT NULL, "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evidenceStatus" varchar(32) DEFAULT 'needs_confirmation' NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL, "revision" integer DEFAULT 1 NOT NULL,
  "memoryId" integer REFERENCES "memories"("id") ON DELETE SET NULL,
  "application" varchar(24) DEFAULT 'pending' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL, "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "memory_review_candidates_kind_check" CHECK ("kind" IN ('user_fact', 'source_fact', 'story_event')),
  CONSTRAINT "memory_review_candidates_ratings_check" CHECK ("confidence" BETWEEN 1 AND 5 AND "importance" BETWEEN 1 AND 5),
  CONSTRAINT "memory_review_candidates_category_check" CHECK ("category" IN ('memory', 'anchor', 'milestone', 'anniversary')),
  CONSTRAINT "memory_review_candidates_evidence_status_check" CHECK ("evidenceStatus" IN ('verified', 'needs_confirmation', 'confirmed_by_user')),
  CONSTRAINT "memory_review_candidates_json_check" CHECK (jsonb_typeof("evidence") = 'array' AND jsonb_typeof("keywords") = 'array'),
  CONSTRAINT "memory_review_candidates_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "memory_review_candidates_scene_check" CHECK (("kind" = 'story_event' AND "sceneId" IS NOT NULL) OR ("kind" <> 'story_event' AND "sceneId" IS NULL)),
  CONSTRAINT "memory_review_candidates_state_check" CHECK (
    ("status" = 'pending' AND "application" = 'pending' AND "memoryId" IS NULL)
    OR ("status" = 'rejected' AND "application" = 'rejected' AND "memoryId" IS NULL)
    OR ("status" = 'accepted' AND (("kind" = 'user_fact' AND "application" = 'memory') OR ("kind" IN ('source_fact', 'story_event') AND "application" = 'reviewed_only' AND "memoryId" IS NULL)))
  )
);
CREATE INDEX IF NOT EXISTS "memory_review_candidates_owner_idx" ON "memory_review_candidates" ("userId", "personaId", "status", "updatedAt");

CREATE TABLE IF NOT EXISTS "memory_review_provenance" (
  "id" serial PRIMARY KEY,
  "candidateId" integer NOT NULL REFERENCES "memory_review_candidates"("id") ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "personaId" integer NOT NULL REFERENCES "personas"("id") ON DELETE CASCADE,
  "kind" varchar(24) NOT NULL, "memoryId" integer REFERENCES "memories"("id") ON DELETE SET NULL,
  "fingerprint" varchar(64) NOT NULL, "evidenceStatus" varchar(32) NOT NULL,
  "evidence" jsonb NOT NULL, "application" varchar(24) NOT NULL, "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "memory_review_provenance_kind_check" CHECK ("kind" IN ('user_fact', 'source_fact', 'story_event')),
  CONSTRAINT "memory_review_provenance_hash_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "memory_review_provenance_evidence_status_check" CHECK ("evidenceStatus" IN ('verified', 'needs_confirmation', 'confirmed_by_user')),
  CONSTRAINT "memory_review_provenance_json_check" CHECK (jsonb_typeof("evidence") = 'array'),
  CONSTRAINT "memory_review_provenance_application_check" CHECK (("application" = 'memory' AND "kind" = 'user_fact') OR ("application" = 'reviewed_only' AND "memoryId" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "memory_review_provenance_candidate_idx" ON "memory_review_provenance" ("candidateId");
CREATE INDEX IF NOT EXISTS "memory_review_provenance_fact_idx" ON "memory_review_provenance" ("userId", "personaId", "fingerprint");
CREATE INDEX IF NOT EXISTS "memory_review_provenance_memory_idx" ON "memory_review_provenance" ("userId", "personaId", "memoryId");

CREATE TABLE IF NOT EXISTS "memory_review_operations" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "personaId" integer NOT NULL REFERENCES "personas"("id") ON DELETE CASCADE,
  "operationId" varchar(64) NOT NULL, "requestHash" varchar(64) NOT NULL,
  "result" jsonb NOT NULL, "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "memory_review_operations_uuid_check" CHECK ("operationId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT "memory_review_operations_hash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "memory_review_operations_json_check" CHECK (jsonb_typeof("result") = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS "memory_review_operations_user_key_idx" ON "memory_review_operations" ("userId", "operationId");
