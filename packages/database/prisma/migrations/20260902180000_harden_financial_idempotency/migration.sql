-- Harden financial-operation idempotency without rewriting existing
-- payment.create / refund.create bindings. `id` remains the FUP operation
-- identity. Existing rows are COMPLETED because they already bind a
-- created Payment or Refund.

CREATE TYPE "idempotency_record_status" AS ENUM ('IN_PROGRESS', 'COMPLETED');

ALTER TABLE "idempotency_records"
  ADD COLUMN "status" "idempotency_record_status";

UPDATE "idempotency_records"
SET "status" = 'COMPLETED'
WHERE "status" IS NULL;

ALTER TABLE "idempotency_records"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'COMPLETED';

ALTER TABLE "idempotency_records"
  ADD COLUMN "updated_at" TIMESTAMPTZ(3);

UPDATE "idempotency_records"
SET "updated_at" = "created_at"
WHERE "updated_at" IS NULL;

ALTER TABLE "idempotency_records"
  ALTER COLUMN "updated_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "idempotency_records_org_status_updated_idx"
  ON "idempotency_records"("organization_id", "status", "updated_at");

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_scope_shape"
  CHECK ("scope" ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$');

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_resource_type_shape"
  CHECK ("resource_type" ~ '^[a-z][a-z0-9]*$');

DO $$
DECLARE
    total integer;
    completed integer;
BEGIN
    SELECT COUNT(*) INTO total FROM "idempotency_records";
    SELECT COUNT(*) INTO completed FROM "idempotency_records" WHERE "status" = 'COMPLETED';
    IF total <> completed THEN
        RAISE EXCEPTION
          'idempotency status backfill mismatch: % rows vs % COMPLETED',
          total,
          completed;
    END IF;
END $$;
