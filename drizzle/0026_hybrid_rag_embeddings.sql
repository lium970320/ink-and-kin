-- mirrai: idempotent-migration
ALTER TABLE "source_library_chunks" ADD COLUMN IF NOT EXISTS "embedding" jsonb;
ALTER TABLE "source_library_chunks" ADD COLUMN IF NOT EXISTS "embeddingFingerprint" varchar(64);
CREATE INDEX IF NOT EXISTS "source_library_chunks_embedding_idx" ON "source_library_chunks" ("documentId", "embeddingFingerprint");
CREATE INDEX IF NOT EXISTS "messages_daily_recall_idx" ON "messages" ("userId", "personaId", "mode", "createdAt", "id");
