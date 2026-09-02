-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "refund_reason" AS ENUM ('CUSTOMER_REQUEST', 'DUPLICATE', 'FRAUDULENT', 'PRODUCT_OR_SERVICE', 'OTHER');

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "status" "refund_status" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" "refund_reason",
    "failure_category" "payment_failure_category",
    "failure_code" VARCHAR(64),
    "failure_message" VARCHAR(512),
    "failure_retryable" BOOLEAN,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- Copy existing payment-create idempotency bindings before dropping the
-- narrow table. Preserve ids so replay identity is unchanged. Works for
-- both zero-row (fresh) and populated (incremental) source tables.
INSERT INTO "idempotency_records" (
    "id",
    "organization_id",
    "scope",
    "key_hash",
    "request_fingerprint",
    "resource_type",
    "resource_id",
    "created_at"
)
SELECT
    "id",
    "organization_id",
    'payment.create',
    "key_hash",
    "request_fingerprint",
    'payment',
    "payment_id",
    "created_at"
FROM "payment_create_idempotency_keys";

DO $$
DECLARE
    src integer;
    dst integer;
BEGIN
    SELECT COUNT(*) INTO src FROM "payment_create_idempotency_keys";
    SELECT COUNT(*) INTO dst FROM "idempotency_records" WHERE "scope" = 'payment.create';
    IF src <> dst THEN
        RAISE EXCEPTION 'idempotency migration count mismatch: % source rows vs % payment.create records', src, dst;
    END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_org_scope_key_uidx" ON "idempotency_records"("organization_id", "scope", "key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_resource_uidx" ON "idempotency_records"("scope", "resource_id");

-- CreateIndex
CREATE INDEX "idempotency_records_org_resource_idx" ON "idempotency_records"("organization_id", "resource_type", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_id_organization_id_key" ON "refunds"("id", "organization_id");

-- CreateIndex
CREATE INDEX "refunds_organization_id_created_at_idx" ON "refunds"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "refunds_organization_id_payment_id_created_at_idx" ON "refunds"("organization_id", "payment_id", "created_at");

-- CreateIndex
CREATE INDEX "refunds_organization_id_status_created_at_idx" ON "refunds"("organization_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_organization_id_fkey" FOREIGN KEY ("payment_id", "organization_id") REFERENCES "payments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_scope_nonempty"
  CHECK (char_length("scope") > 0);

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_resource_type_nonempty"
  CHECK (char_length("resource_type") > 0);

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_key_hash_sha256"
  CHECK ("key_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_fingerprint_sha256"
  CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_currency_iso_shape"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_failure_fields_consistent"
  CHECK (
    (
      "status" = 'FAILED'
      AND "failure_category" IS NOT NULL
      AND "failure_message" IS NOT NULL
      AND char_length("failure_message") > 0
      AND "failure_retryable" IS NOT NULL
    )
    OR
    (
      "status" <> 'FAILED'
      AND "failure_category" IS NULL
      AND "failure_code" IS NULL
      AND "failure_message" IS NULL
      AND "failure_retryable" IS NULL
    )
  );

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_failure_code_nonempty"
  CHECK ("failure_code" IS NULL OR char_length("failure_code") > 0);

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_metadata_object"
  CHECK (jsonb_typeof("metadata") = 'object');

DROP TABLE "payment_create_idempotency_keys";
