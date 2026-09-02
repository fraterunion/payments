-- Provider-neutral payment/refund executions and Inbox claim/retry fields
-- for Stripe webhook normalization. Provider object IDs never live on
-- payments or refunds. Do not drop inbox_events_stripe_external_event_uidx.

-- Existing RECEIVED inbox rows become immediately claimable.
ALTER TABLE "inbox_events"
  ADD COLUMN "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "claimed_at" TIMESTAMPTZ(3),
  ADD COLUMN "claim_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "claimed_by" VARCHAR(128),
  ADD COLUMN "processing_outcome" VARCHAR(64);

CREATE INDEX "inbox_events_status_available_at_idx"
  ON "inbox_events"("status", "available_at");

CREATE INDEX "inbox_events_status_claim_expires_at_idx"
  ON "inbox_events"("status", "claim_expires_at");

CREATE INDEX "inbox_events_source_status_available_at_idx"
  ON "inbox_events"("source", "status", "available_at");

UPDATE "inbox_events"
SET
  "claimed_at" = COALESCE("processing_started_at", CURRENT_TIMESTAMP),
  "claim_expires_at" = CURRENT_TIMESTAMP,
  "claimed_by" = 'pre-claim-backfill'
WHERE "status" = 'PROCESSING'
  AND ("claimed_by" IS NULL OR "claim_expires_at" IS NULL);

ALTER TABLE "inbox_events"
  ADD CONSTRAINT "inbox_events_processing_claim_fields"
  CHECK (
    "status" <> 'PROCESSING'
    OR (
      "claimed_at" IS NOT NULL
      AND "claim_expires_at" IS NOT NULL
      AND "claimed_by" IS NOT NULL
      AND char_length("claimed_by") > 0
    )
  );

ALTER TABLE "inbox_events"
  ADD CONSTRAINT "inbox_events_processing_outcome_nonempty"
  CHECK (
    "processing_outcome" IS NULL
    OR char_length("processing_outcome") > 0
  );

CREATE UNIQUE INDEX "refunds_id_organization_id_payment_id_key"
  ON "refunds"("id", "organization_id", "payment_id");

CREATE TABLE "payment_provider_executions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "provider_account_reference" VARCHAR(255),
  "provider_account_scope" VARCHAR(261) NOT NULL,
  "provider_payment_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "payment_provider_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_provider_executions_id_organization_id_key"
  ON "payment_provider_executions"("id", "organization_id");

CREATE UNIQUE INDEX "payment_provider_executions_id_organization_id_payment_id_key"
  ON "payment_provider_executions"("id", "organization_id", "payment_id");

CREATE UNIQUE INDEX "payment_provider_executions_provider_object_uidx"
  ON "payment_provider_executions"("provider", "provider_account_scope", "provider_payment_id");

CREATE INDEX "payment_provider_executions_organization_id_payment_id_idx"
  ON "payment_provider_executions"("organization_id", "payment_id");

ALTER TABLE "payment_provider_executions"
  ADD CONSTRAINT "payment_provider_executions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_provider_executions"
  ADD CONSTRAINT "payment_provider_executions_payment_org_fkey"
  FOREIGN KEY ("payment_id", "organization_id") REFERENCES "payments"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_provider_executions"
  ADD CONSTRAINT "payment_provider_executions_provider_shape"
  CHECK ("provider" ~ '^[a-z0-9_-]+$');

ALTER TABLE "payment_provider_executions"
  ADD CONSTRAINT "payment_provider_executions_provider_payment_id_nonempty"
  CHECK (char_length("provider_payment_id") > 0);

ALTER TABLE "payment_provider_executions"
  ADD CONSTRAINT "payment_provider_executions_account_scope_nonempty"
  CHECK (char_length("provider_account_scope") > 0);

ALTER TABLE "payment_provider_executions"
  ADD CONSTRAINT "payment_provider_executions_account_scope_consistent"
  CHECK (
    ("provider_account_reference" IS NULL AND "provider_account_scope" = 'default')
    OR (
      "provider_account_reference" IS NOT NULL
      AND "provider_account_scope" = ('acct:' || "provider_account_reference")
    )
  );

CREATE TABLE "refund_provider_executions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "refund_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "payment_provider_execution_id" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "provider_account_reference" VARCHAR(255),
  "provider_account_scope" VARCHAR(261) NOT NULL,
  "provider_refund_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "refund_provider_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refund_provider_executions_id_organization_id_key"
  ON "refund_provider_executions"("id", "organization_id");

CREATE UNIQUE INDEX "refund_provider_executions_provider_object_uidx"
  ON "refund_provider_executions"("provider", "provider_account_scope", "provider_refund_id");

CREATE INDEX "refund_provider_executions_organization_id_refund_id_idx"
  ON "refund_provider_executions"("organization_id", "refund_id");

CREATE INDEX "refund_provider_executions_payment_provider_execution_id_idx"
  ON "refund_provider_executions"("payment_provider_execution_id");

ALTER TABLE "refund_provider_executions"
  ADD CONSTRAINT "refund_provider_executions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refund_provider_executions"
  ADD CONSTRAINT "refund_provider_executions_refund_org_payment_fkey"
  FOREIGN KEY ("refund_id", "organization_id", "payment_id")
  REFERENCES "refunds"("id", "organization_id", "payment_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refund_provider_executions"
  ADD CONSTRAINT "refund_provider_executions_payment_execution_fkey"
  FOREIGN KEY ("payment_provider_execution_id", "organization_id", "payment_id")
  REFERENCES "payment_provider_executions"("id", "organization_id", "payment_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refund_provider_executions"
  ADD CONSTRAINT "refund_provider_executions_provider_shape"
  CHECK ("provider" ~ '^[a-z0-9_-]+$');

ALTER TABLE "refund_provider_executions"
  ADD CONSTRAINT "refund_provider_executions_provider_refund_id_nonempty"
  CHECK (char_length("provider_refund_id") > 0);

ALTER TABLE "refund_provider_executions"
  ADD CONSTRAINT "refund_provider_executions_account_scope_nonempty"
  CHECK (char_length("provider_account_scope") > 0);

ALTER TABLE "refund_provider_executions"
  ADD CONSTRAINT "refund_provider_executions_account_scope_consistent"
  CHECK (
    ("provider_account_reference" IS NULL AND "provider_account_scope" = 'default')
    OR (
      "provider_account_reference" IS NOT NULL
      AND "provider_account_scope" = ('acct:' || "provider_account_reference")
    )
  );
