-- mirrai: idempotent-migration
CREATE TABLE IF NOT EXISTS scene_image_jobs (
  "userId" integer NOT NULL CONSTRAINT "scene_image_jobs_userId_users_id_fk" REFERENCES users(id) ON DELETE CASCADE,
  id varchar(36) NOT NULL, "personaId" integer, "sceneId" integer,
  "contextRevision" integer, "configRevision" integer NOT NULL DEFAULT 0,
  kind varchar(16) NOT NULL, status varchar(16) NOT NULL,
  "relayName" varchar(128), model varchar(160), "promptText" text, "testMode" varchar(16), attempt integer NOT NULL DEFAULT 0,
  "relayId" integer, "referenceMode" varchar(48), "outputKey" varchar(256), "messageId" integer,
  "errorCode" varchar(48), "durationMs" integer,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), deadline timestamptz NOT NULL,
  CONSTRAINT scene_image_jobs_owner_pk PRIMARY KEY ("userId",id),
  CONSTRAINT scene_image_jobs_persona_owner_fk FOREIGN KEY ("personaId","userId") REFERENCES personas(id,"userId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS scene_image_jobs_owner_time_idx ON scene_image_jobs("userId","createdAt");
