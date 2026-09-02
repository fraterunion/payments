-- CreateEnum
CREATE TYPE "customer_type" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "customer_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "customer_type" NOT NULL DEFAULT 'INDIVIDUAL',
    "status" "customer_status" NOT NULL DEFAULT 'ACTIVE',
    "email" VARCHAR(320),
    "name" VARCHAR(200),
    "phone" VARCHAR(16),
    "external_reference" VARCHAR(128),
    "description" VARCHAR(2000),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_provider_mappings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_account_reference" VARCHAR(255),
    "provider_account_scope" VARCHAR(261) NOT NULL,
    "provider_customer_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_organization_id_status_created_at_idx" ON "customers"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "customers_organization_id_created_at_idx" ON "customers"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "customers_organization_id_email_idx" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_id_organization_id_key" ON "customers"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_org_external_ref_uidx" ON "customers"("organization_id", "external_reference");

-- CreateIndex
CREATE INDEX "customer_provider_mappings_organization_id_customer_id_idx" ON "customer_provider_mappings"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_provider_mappings_organization_id_provider_provide_idx" ON "customer_provider_mappings"("organization_id", "provider", "provider_account_scope");

-- CreateIndex
CREATE UNIQUE INDEX "customer_provider_mappings_id_organization_id_key" ON "customer_provider_mappings"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_provider_mappings_provider_identity_uidx" ON "customer_provider_mappings"("organization_id", "provider", "provider_account_scope", "provider_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_provider_mappings_customer_provider_scope_uidx" ON "customer_provider_mappings"("customer_id", "provider", "provider_account_scope");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_provider_mappings" ADD CONSTRAINT "customer_provider_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_provider_mappings" ADD CONSTRAINT "customer_provider_mappings_customer_id_organization_id_fkey" FOREIGN KEY ("customer_id", "organization_id") REFERENCES "customers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_status_archived_at_consistent"
  CHECK (
    ("status" = 'ACTIVE' AND "archived_at" IS NULL)
    OR
    ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL)
  );

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_email_nonempty"
  CHECK ("email" IS NULL OR char_length("email") > 0);

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_name_nonempty"
  CHECK ("name" IS NULL OR char_length("name") > 0);

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_phone_nonempty"
  CHECK ("phone" IS NULL OR char_length("phone") > 0);

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_external_reference_nonempty"
  CHECK ("external_reference" IS NULL OR char_length("external_reference") > 0);

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_description_nonempty"
  CHECK ("description" IS NULL OR char_length("description") > 0);

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_metadata_object"
  CHECK (jsonb_typeof("metadata") = 'object');

ALTER TABLE "customer_provider_mappings"
  ADD CONSTRAINT "customer_provider_mappings_provider_nonempty"
  CHECK (char_length("provider") > 0);

ALTER TABLE "customer_provider_mappings"
  ADD CONSTRAINT "customer_provider_mappings_provider_customer_id_nonempty"
  CHECK (char_length("provider_customer_id") > 0);

ALTER TABLE "customer_provider_mappings"
  ADD CONSTRAINT "customer_provider_mappings_account_scope_nonempty"
  CHECK (char_length("provider_account_scope") > 0);

ALTER TABLE "customer_provider_mappings"
  ADD CONSTRAINT "customer_provider_mappings_account_scope_consistent"
  CHECK (
    ("provider_account_reference" IS NULL AND "provider_account_scope" = 'default')
    OR
    (
      "provider_account_reference" IS NOT NULL
      AND "provider_account_scope" = ('acct:' || "provider_account_reference")
    )
  );
