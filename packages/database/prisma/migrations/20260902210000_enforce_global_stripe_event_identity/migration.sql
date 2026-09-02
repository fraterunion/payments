-- Stripe Event IDs are provider identity, not tenant identity. Generic
-- inbox uniqueness remains (scope_key, source, external_event_id). For
-- source = 'stripe' only, the same external_event_id may exist once
-- regardless of scope_key.
--
-- Prisma cannot declare partial unique indexes in schema.prisma. This
-- index is SQL-only, complementary to the generic unique constraint,
-- matching the users_email_lower_uidx precedent. Do not drop it via
-- prisma migrate diff.
--
-- Existing-data safety: fail loudly if duplicate Stripe event IDs already
-- exist across scopes. This migration never deletes or merges inbox rows.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "inbox_events"
    WHERE "source" = 'stripe'
    GROUP BY "source", "external_event_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce global Stripe event identity: duplicate (source, external_event_id) rows exist for source=stripe. Resolve them manually before applying this migration. No inbox rows were deleted or merged.';
  END IF;
END $$;

CREATE UNIQUE INDEX "inbox_events_stripe_external_event_uidx"
ON "inbox_events"("source", "external_event_id")
WHERE "source" = 'stripe';
