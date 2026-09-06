-- CreateEnum
CREATE TYPE "ledger_account_type" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ledger_account_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ledger_entry_side" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "ledger_account_type" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "ledger_account_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "transaction_type" VARCHAR(64) NOT NULL,
    "reference_type" VARCHAR(64),
    "reference_id" VARCHAR(128),
    "currency" VARCHAR(3) NOT NULL,
    "description" VARCHAR(500),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "reverses_ledger_transaction_id" UUID,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ledger_transaction_id" UUID NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "side" "ledger_entry_side" NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_accounts_id_organization_id_key" ON "ledger_accounts"("id", "organization_id");
CREATE UNIQUE INDEX "ledger_accounts_org_code_uidx" ON "ledger_accounts"("organization_id", "code");
CREATE INDEX "ledger_accounts_organization_id_status_created_at_idx" ON "ledger_accounts"("organization_id", "status", "created_at");
CREATE INDEX "ledger_accounts_organization_id_currency_created_at_idx" ON "ledger_accounts"("organization_id", "currency", "created_at");

CREATE UNIQUE INDEX "ledger_transactions_id_organization_id_key" ON "ledger_transactions"("id", "organization_id");
CREATE INDEX "ledger_transactions_org_posted_idx" ON "ledger_transactions"("organization_id", "posted_at");
CREATE INDEX "ledger_transactions_org_type_posted_idx" ON "ledger_transactions"("organization_id", "transaction_type", "posted_at");
CREATE INDEX "ledger_transactions_org_ref_idx" ON "ledger_transactions"("organization_id", "reference_type", "reference_id");
CREATE INDEX "ledger_transactions_org_currency_posted_idx" ON "ledger_transactions"("organization_id", "currency", "posted_at");

CREATE INDEX "ledger_entries_organization_id_ledger_account_id_idx" ON "ledger_entries"("organization_id", "ledger_account_id");
CREATE INDEX "ledger_entries_ledger_transaction_id_idx" ON "ledger_entries"("ledger_transaction_id");

ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_ledger_transaction_id_organization_id_fkey" FOREIGN KEY ("reverses_ledger_transaction_id", "organization_id") REFERENCES "ledger_transactions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ledger_transaction_id_organization_id_fkey" FOREIGN KEY ("ledger_transaction_id", "organization_id") REFERENCES "ledger_transactions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ledger_account_id_organization_id_fkey" FOREIGN KEY ("ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_code_shape"
  CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]*$');

ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_name_nonempty"
  CHECK (char_length("name") > 0);

ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_currency_shape"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_status_archive"
  CHECK (
    ("status" = 'ACTIVE' AND "archived_at" IS NULL)
    OR ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL)
  );

ALTER TABLE "ledger_transactions"
  ADD CONSTRAINT "ledger_transactions_type_shape"
  CHECK ("transaction_type" ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$');

ALTER TABLE "ledger_transactions"
  ADD CONSTRAINT "ledger_transactions_currency_shape"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "ledger_transactions"
  ADD CONSTRAINT "ledger_transactions_reference_pair"
  CHECK (
    ("reference_type" IS NULL AND "reference_id" IS NULL)
    OR (
      "reference_type" IS NOT NULL
      AND "reference_id" IS NOT NULL
      AND char_length("reference_type") > 0
      AND char_length("reference_id") > 0
    )
  );

ALTER TABLE "ledger_transactions"
  ADD CONSTRAINT "ledger_transactions_description_nonempty"
  CHECK ("description" IS NULL OR char_length("description") > 0);

ALTER TABLE "ledger_transactions"
  ADD CONSTRAINT "ledger_transactions_metadata_object"
  CHECK (jsonb_typeof("metadata") = 'object');

ALTER TABLE "ledger_transactions"
  ADD CONSTRAINT "ledger_transactions_not_self_reversal"
  CHECK (
    "reverses_ledger_transaction_id" IS NULL
    OR "reverses_ledger_transaction_id" <> "id"
  );

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_positive"
  CHECK ("amount" > 0);

CREATE FUNCTION prevent_ledger_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_transactions is append-only';
END;
$$;

CREATE FUNCTION prevent_ledger_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END;
$$;

CREATE FUNCTION prevent_ledger_account_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_accounts cannot be deleted';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'ledger_accounts cannot be truncated';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.currency IS DISTINCT FROM OLD.currency
  THEN
    RAISE EXCEPTION 'ledger_accounts identity fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_ledger_transaction_is_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  txn_id uuid;
  entry_count integer;
  debit_sum bigint;
  credit_sum bigint;
BEGIN
  IF TG_TABLE_NAME = 'ledger_transactions' THEN
    txn_id := NEW.id;
  ELSE
    txn_id := NEW.ledger_transaction_id;
  END IF;

  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount ELSE 0 END), 0)
  INTO entry_count, debit_sum, credit_sum
  FROM ledger_entries
  WHERE ledger_transaction_id = txn_id;

  IF entry_count < 2 THEN
    RAISE EXCEPTION 'ledger_transaction % must have at least two entries', txn_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF debit_sum IS DISTINCT FROM credit_sum THEN
    RAISE EXCEPTION 'ledger_transaction % is unbalanced', txn_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER ledger_transactions_immutable
BEFORE UPDATE OR DELETE ON "ledger_transactions"
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_transaction_mutation();

CREATE TRIGGER ledger_transactions_immutable_truncate
BEFORE TRUNCATE ON "ledger_transactions"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_ledger_transaction_mutation();

CREATE TRIGGER ledger_entries_immutable
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_entry_mutation();

CREATE TRIGGER ledger_entries_immutable_truncate
BEFORE TRUNCATE ON "ledger_entries"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_ledger_entry_mutation();

CREATE TRIGGER ledger_accounts_identity_immutable
BEFORE UPDATE OR DELETE ON "ledger_accounts"
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_account_identity_mutation();

CREATE TRIGGER ledger_accounts_immutable_truncate
BEFORE TRUNCATE ON "ledger_accounts"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_ledger_account_identity_mutation();

CREATE CONSTRAINT TRIGGER ledger_transactions_balanced
AFTER INSERT ON "ledger_transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION assert_ledger_transaction_is_balanced();

CREATE CONSTRAINT TRIGGER ledger_entries_transaction_balanced
AFTER INSERT ON "ledger_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION assert_ledger_transaction_is_balanced();
