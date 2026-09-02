-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('CREATED', 'REQUIRES_PAYMENT_METHOD', 'REQUIRES_ACTION', 'AUTHORIZING', 'AUTHORIZED', 'CAPTURING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "payment_capture_method" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "payment_failure_category" AS ENUM ('DECLINED', 'AUTHENTICATION', 'INSUFFICIENT_FUNDS', 'INVALID_PAYMENT_METHOD', 'PROCESSING', 'PROVIDER', 'UNKNOWN');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" "payment_status" NOT NULL,
    "capture_method" "payment_capture_method" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "requested_amount" BIGINT NOT NULL,
    "authorized_amount" BIGINT NOT NULL DEFAULT 0,
    "captured_amount" BIGINT NOT NULL DEFAULT 0,
    "refunded_amount" BIGINT NOT NULL DEFAULT 0,
    "failure_category" "payment_failure_category",
    "failure_code" VARCHAR(64),
    "failure_message" VARCHAR(512),
    "failure_retryable" BOOLEAN,
    "description" VARCHAR(500),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_create_idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "payment_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_create_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_organization_id_created_at_idx" ON "payments"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_organization_id_status_created_at_idx" ON "payments"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "payments_organization_id_customer_id_created_at_idx" ON "payments"("organization_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_organization_id_currency_created_at_idx" ON "payments"("organization_id", "currency", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_organization_id_key" ON "payments"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_create_idempotency_keys_payment_id_key" ON "payment_create_idempotency_keys"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_create_idempotency_org_key_uidx" ON "payment_create_idempotency_keys"("organization_id", "key_hash");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_organization_id_fkey" FOREIGN KEY ("customer_id", "organization_id") REFERENCES "customers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_create_idempotency_keys" ADD CONSTRAINT "payment_create_idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_create_idempotency_keys" ADD CONSTRAINT "payment_create_idempotency_keys_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_currency_iso_shape"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_requested_amount_positive"
  CHECK ("requested_amount" > 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_authorized_amount_nonnegative"
  CHECK ("authorized_amount" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_captured_amount_nonnegative"
  CHECK ("captured_amount" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_refunded_amount_nonnegative"
  CHECK ("refunded_amount" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_refunded_lte_captured"
  CHECK ("refunded_amount" <= "captured_amount");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_captured_lte_authorized"
  CHECK ("captured_amount" <= "authorized_amount");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_authorized_lte_requested"
  CHECK ("authorized_amount" <= "requested_amount");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_succeeded_has_capture"
  CHECK (
    "status" NOT IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')
    OR "captured_amount" > 0
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_failure_fields_consistent"
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

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_failure_code_nonempty"
  CHECK ("failure_code" IS NULL OR char_length("failure_code") > 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_description_nonempty"
  CHECK ("description" IS NULL OR char_length("description") > 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_metadata_object"
  CHECK (jsonb_typeof("metadata") = 'object');

ALTER TABLE "payment_create_idempotency_keys"
  ADD CONSTRAINT "payment_create_idempotency_key_hash_sha256"
  CHECK ("key_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "payment_create_idempotency_keys"
  ADD CONSTRAINT "payment_create_idempotency_fingerprint_sha256"
  CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$');
