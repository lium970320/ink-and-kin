-- mirrai: idempotent-migration
ALTER TABLE "reminder_deliveries"
  ADD COLUMN IF NOT EXISTS "status" varchar(16) DEFAULT 'confirmed' NOT NULL,
  ADD COLUMN IF NOT EXISTS "reason" varchar(80);
