-- mirrai: idempotent-migration

CREATE TABLE IF NOT EXISTS "scene_image_configs" (
  "userId" integer PRIMARY KEY,
  "settings" jsonb NOT NULL,
  "relays" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "revision" integer NOT NULL,
  "nextRelayId" integer DEFAULT 1 NOT NULL,
  "updatedAt" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "scene_image_configs_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "scene_image_configs_version_check" CHECK ("revision" > 0 AND "nextRelayId" > 0),
  CONSTRAINT "scene_image_configs_settings_check" CHECK (jsonb_typeof("settings") = 'object'),
  CONSTRAINT "scene_image_configs_relays_check" CHECK (CASE WHEN jsonb_typeof("relays") = 'array'
    THEN jsonb_array_length("relays") <= 24 AND NOT jsonb_path_exists("relays", '$[*].apiKey') ELSE false END)
);
