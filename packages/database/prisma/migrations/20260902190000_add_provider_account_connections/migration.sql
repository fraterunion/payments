-- Canonical provider-neutral merchant connections. Not Stripe-named columns.
-- Organization FK is RESTRICT. No cascade. No onboarding URL / KYC storage.

CREATE TYPE "provider_account_connection_status" AS ENUM (
  'PENDING',
  'REQUIRES_ACTION',
  'ACTIVE',
  'RESTRICTED',
  'DISCONNECTED'
);

CREATE TABLE "provider_account_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_account_id" VARCHAR(255) NOT NULL,
    "status" "provider_account_connection_status" NOT NULL,
    "payments_enabled" BOOLEAN NOT NULL,
    "payouts_enabled" BOOLEAN NOT NULL,
    "requirements_due" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_account_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_account_connections_id_organization_id_key"
  ON "provider_account_connections"("id", "organization_id");

CREATE UNIQUE INDEX "provider_account_connections_organization_id_provider_key"
  ON "provider_account_connections"("organization_id", "provider");

CREATE UNIQUE INDEX "provider_account_connections_provider_provider_account_id_key"
  ON "provider_account_connections"("provider", "provider_account_id");

CREATE INDEX "provider_account_connections_organization_id_status_idx"
  ON "provider_account_connections"("organization_id", "status");

ALTER TABLE "provider_account_connections"
  ADD CONSTRAINT "provider_account_connections_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provider_account_connections"
  ADD CONSTRAINT "provider_account_connections_provider_shape"
  CHECK ("provider" ~ '^[a-z0-9_-]+$' AND char_length("provider") > 0);

ALTER TABLE "provider_account_connections"
  ADD CONSTRAINT "provider_account_connections_provider_account_id_nonempty"
  CHECK (char_length("provider_account_id") > 0);

ALTER TABLE "provider_account_connections"
  ADD CONSTRAINT "provider_account_connections_active_capabilities"
  CHECK (
    "status" <> 'ACTIVE'
    OR ("payments_enabled" AND "payouts_enabled")
  );
