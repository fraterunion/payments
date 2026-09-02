-- Persist verified inbound payloads so later processing can read the
-- durable receipt. Existing rows receive an empty object; Stripe webhook
-- ingestion always writes the verified event JSON. Hash semantics are
-- unchanged.

ALTER TABLE "inbox_events"
  ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "inbox_events"
  ADD CONSTRAINT "inbox_events_payload_object"
  CHECK (jsonb_typeof("payload") = 'object');
