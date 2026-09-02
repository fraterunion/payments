-- CreateEnum
CREATE TYPE "outbox_event_status" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "inbox_event_status" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "event_type" VARCHAR(128) NOT NULL,
    "aggregate_type" VARCHAR(128),
    "aggregate_id" VARCHAR(128),
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" VARCHAR(128),
    "causation_id" VARCHAR(128),
    "status" "outbox_event_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(3),
    "claim_expires_at" TIMESTAMPTZ(3),
    "claimed_by" VARCHAR(128),
    "processed_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(64),
    "last_error_message" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "scope_key" VARCHAR(64) NOT NULL,
    "source" VARCHAR(128) NOT NULL,
    "external_event_id" VARCHAR(256) NOT NULL,
    "event_type" VARCHAR(128) NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "status" "inbox_event_status" NOT NULL DEFAULT 'RECEIVED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_started_at" TIMESTAMPTZ(3),
    "processed_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(64),
    "last_error_message" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_claim_expires_at_idx" ON "outbox_events"("status", "claim_expires_at");

-- CreateIndex
CREATE INDEX "outbox_events_organization_id_idx" ON "outbox_events"("organization_id");

-- CreateIndex
CREATE INDEX "outbox_events_event_type_idx" ON "outbox_events"("event_type");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "outbox_events_created_at_idx" ON "outbox_events"("created_at");

-- CreateIndex
CREATE INDEX "inbox_events_organization_id_idx" ON "inbox_events"("organization_id");

-- CreateIndex
CREATE INDEX "inbox_events_status_idx" ON "inbox_events"("status");

-- CreateIndex
CREATE INDEX "inbox_events_event_type_idx" ON "inbox_events"("event_type");

-- CreateIndex
CREATE INDEX "inbox_events_received_at_idx" ON "inbox_events"("received_at");

-- CreateIndex
CREATE INDEX "inbox_events_processed_at_idx" ON "inbox_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_events_scope_key_source_external_event_id_key" ON "inbox_events"("scope_key", "source", "external_event_id");

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_events" ADD CONSTRAINT "inbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- State and identity invariants Prisma cannot declare in schema.prisma.
-- Application services still validate transitions; these CHECKs prevent
-- structurally impossible rows.

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempt_count_nonnegative"
  CHECK ("attempt_count" >= 0);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_event_type_nonempty"
  CHECK (char_length("event_type") > 0);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_processed_requires_timestamp"
  CHECK ("status" <> 'PROCESSED' OR "processed_at" IS NOT NULL);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_processing_requires_claim"
  CHECK (
    "status" <> 'PROCESSING'
    OR (
      "claimed_at" IS NOT NULL
      AND "claim_expires_at" IS NOT NULL
      AND "claimed_by" IS NOT NULL
    )
  );

ALTER TABLE "inbox_events"
  ADD CONSTRAINT "inbox_events_attempt_count_nonnegative"
  CHECK ("attempt_count" >= 0);

ALTER TABLE "inbox_events"
  ADD CONSTRAINT "inbox_events_source_nonempty"
  CHECK (char_length("source") > 0);

ALTER TABLE "inbox_events"
  ADD CONSTRAINT "inbox_events_external_event_id_nonempty"
  CHECK (char_length("external_event_id") > 0);

ALTER TABLE "inbox_events"
  ADD CONSTRAINT "inbox_events_processed_requires_timestamp"
  CHECK ("status" <> 'PROCESSED' OR "processed_at" IS NOT NULL);

ALTER TABLE "inbox_events"
  ADD CONSTRAINT "inbox_events_scope_matches_ownership"
  CHECK (
    ("organization_id" IS NULL AND "scope_key" = 'platform')
    OR ("organization_id" IS NOT NULL AND "scope_key" = "organization_id"::text)
  );
