CREATE TYPE "ledger_account_binding_role" AS ENUM ('PROVIDER_RECEIVABLE', 'SETTLEMENT_PAYABLE');

CREATE TABLE "ledger_account_bindings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "ledger_account_binding_role" NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_account_scope" VARCHAR(261) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_account_bindings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_account_bindings_id_organization_id_key"
  ON "ledger_account_bindings"("id", "organization_id");
CREATE UNIQUE INDEX "ledger_account_bindings_role_scope_uidx"
  ON "ledger_account_bindings"("organization_id", "role", "provider", "provider_account_scope", "currency");
CREATE INDEX "ledger_account_bindings_organization_id_ledger_account_id_idx"
  ON "ledger_account_bindings"("organization_id", "ledger_account_id");

ALTER TABLE "ledger_account_bindings"
  ADD CONSTRAINT "ledger_account_bindings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_account_bindings"
  ADD CONSTRAINT "ledger_account_bindings_ledger_account_id_organization_id_fkey"
  FOREIGN KEY ("ledger_account_id", "organization_id")
  REFERENCES "ledger_accounts"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_account_bindings"
  ADD CONSTRAINT "ledger_account_bindings_provider_shape"
  CHECK ("provider" ~ '^[a-z0-9_-]+$' AND char_length("provider") > 0);

ALTER TABLE "ledger_account_bindings"
  ADD CONSTRAINT "ledger_account_bindings_scope_shape"
  CHECK (
    "provider_account_scope" = 'default'
    OR "provider_account_scope" ~ '^acct:.+'
  );

ALTER TABLE "ledger_account_bindings"
  ADD CONSTRAINT "ledger_account_bindings_currency_shape"
  CHECK ("currency" ~ '^[A-Z]{3}$');

CREATE FUNCTION prevent_ledger_account_binding_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_account_bindings is immutable';
END;
$$;

CREATE FUNCTION assert_ledger_account_binding_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_type ledger_account_type;
  account_currency varchar;
  account_status ledger_account_status;
BEGIN
  SELECT type, currency, status
    INTO account_type, account_currency, account_status
  FROM ledger_accounts
  WHERE id = NEW.ledger_account_id
    AND organization_id = NEW.organization_id;

  IF account_type IS NULL THEN
    RAISE EXCEPTION 'ledger_account_binding references an unknown account'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF account_status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'ledger_account_binding cannot use an archived account'
      USING ERRCODE = 'check_violation';
  END IF;
  IF account_currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'ledger_account_binding currency must match the account'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.role = 'PROVIDER_RECEIVABLE' AND account_type IS DISTINCT FROM 'ASSET' THEN
    RAISE EXCEPTION 'PROVIDER_RECEIVABLE must bind an ASSET account'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.role = 'SETTLEMENT_PAYABLE' AND account_type IS DISTINCT FROM 'LIABILITY' THEN
    RAISE EXCEPTION 'SETTLEMENT_PAYABLE must bind a LIABILITY account'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_bound_ledger_account_archive()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'ARCHIVED' AND OLD.status IS DISTINCT FROM 'ARCHIVED' THEN
    IF EXISTS (
      SELECT 1 FROM ledger_account_bindings
      WHERE ledger_account_id = OLD.id
        AND organization_id = OLD.organization_id
    ) THEN
      RAISE EXCEPTION 'bound ledger_accounts cannot be archived';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_account_bindings_immutable
BEFORE UPDATE OR DELETE ON "ledger_account_bindings"
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_account_binding_mutation();

CREATE TRIGGER ledger_account_bindings_immutable_truncate
BEFORE TRUNCATE ON "ledger_account_bindings"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_ledger_account_binding_mutation();

CREATE TRIGGER ledger_account_bindings_role_consistent
BEFORE INSERT ON "ledger_account_bindings"
FOR EACH ROW
EXECUTE FUNCTION assert_ledger_account_binding_role();

CREATE TRIGGER ledger_accounts_bound_archive
BEFORE UPDATE ON "ledger_accounts"
FOR EACH ROW
EXECUTE FUNCTION prevent_bound_ledger_account_archive();
