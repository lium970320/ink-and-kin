-- mirrai: idempotent-migration
CREATE TABLE IF NOT EXISTS chat_context_states (
 id serial PRIMARY KEY, "userId" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 "personaId" integer NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
 "startAfterMessageId" integer NOT NULL DEFAULT 0, overrides jsonb NOT NULL DEFAULT '{}',
 revision integer NOT NULL DEFAULT 0, "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_context_states_owner_idx ON chat_context_states ("userId","personaId");
CREATE TABLE IF NOT EXISTS chat_deletion_backups (
 id serial PRIMARY KEY, "userId" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 "personaId" integer NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now()
);
