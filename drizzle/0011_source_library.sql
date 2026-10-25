-- mirrai: idempotent-migration
CREATE TABLE IF NOT EXISTS "source_library_documents" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "personaId" integer NOT NULL REFERENCES "personas"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL, "fileName" varchar(255) NOT NULL, "format" varchar(8) NOT NULL,
  "byteSize" integer NOT NULL, "fileHash" varchar(64) NOT NULL, "chunkCount" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL, "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "source_library_documents_format_check" CHECK ("format" IN ('txt', 'md', 'epub')),
  CONSTRAINT "source_library_documents_size_check" CHECK ("byteSize" > 0 AND "chunkCount" > 0),
  CONSTRAINT "source_library_documents_hash_check" CHECK ("fileHash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS "source_library_documents_owner_idx" ON "source_library_documents" ("userId", "personaId", "createdAt");
CREATE TABLE IF NOT EXISTS "source_library_chunks" (
  "id" serial PRIMARY KEY,
  "documentId" integer NOT NULL REFERENCES "source_library_documents"("id") ON DELETE CASCADE,
  "chunkIndex" integer NOT NULL, "chapterTitle" varchar(200) NOT NULL, "content" text NOT NULL,
  "startOffset" integer NOT NULL, "endOffset" integer NOT NULL,
  "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL, "tokenEstimate" integer NOT NULL,
  CONSTRAINT "source_library_chunks_offsets_check" CHECK ("chunkIndex" >= 0 AND "startOffset" >= 0 AND "endOffset" >= "startOffset"),
  CONSTRAINT "source_library_chunks_tokens_check" CHECK ("tokenEstimate" >= 0),
  CONSTRAINT "source_library_chunks_keywords_check" CHECK (jsonb_typeof("keywords") = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS "source_library_chunks_document_index_idx" ON "source_library_chunks" ("documentId", "chunkIndex");
