-- Append-only audit_logs: reject UPDATE/DELETE, keep original actor IDs
-- when live actor rows are deactivated, and constrain actor/action/metadata.

-- Physical user/API-key deletion must not SET NULL an immutable audit row.
-- Deactivate users and revoke API keys instead.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_user_id_fkey";
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_api_key_id_fkey";

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_api_key_id_fkey"
  FOREIGN KEY ("actor_api_key_id") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_not_both_actors"
  CHECK (NOT ("actor_user_id" IS NOT NULL AND "actor_api_key_id" IS NOT NULL));

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_action_nonempty"
  CHECK (char_length("action") > 0);

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_resource_type_nonempty"
  CHECK (char_length("resource_type") > 0);

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_metadata_object"
  CHECK (jsonb_typeof("metadata") = 'object');

-- Tenant-scoped query shapes used by AuditService.list.
DROP INDEX "audit_logs_resource_type_resource_id_idx";
DROP INDEX "audit_logs_actor_user_id_idx";
DROP INDEX "audit_logs_actor_api_key_id_idx";
DROP INDEX "audit_logs_request_id_idx";
DROP INDEX "audit_logs_action_idx";

CREATE INDEX "audit_logs_organization_id_action_created_at_idx"
  ON "audit_logs"("organization_id", "action", "created_at");

CREATE INDEX "audit_logs_organization_id_resource_type_resource_id_created_at_idx"
  ON "audit_logs"("organization_id", "resource_type", "resource_id", "created_at");

CREATE INDEX "audit_logs_organization_id_actor_user_id_created_at_idx"
  ON "audit_logs"("organization_id", "actor_user_id", "created_at");

CREATE INDEX "audit_logs_organization_id_actor_api_key_id_created_at_idx"
  ON "audit_logs"("organization_id", "actor_api_key_id", "created_at");

CREATE INDEX "audit_logs_organization_id_request_id_idx"
  ON "audit_logs"("organization_id", "request_id");

CREATE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

CREATE TRIGGER audit_logs_immutable
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER audit_logs_immutable_truncate
BEFORE TRUNCATE ON "audit_logs"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_audit_log_mutation();
