# Stripe webhook ingestion

Receipt boundary for Stripe webhook HTTP deliveries. This document
describes verify, resolve tenant, persist a durable inbox row, and
acknowledge. Canonical Payment / Refund mutation is documented in
[`stripe-webhook-normalization.md`](./stripe-webhook-normalization.md).
This HTTP path does **not** write a ledger or enqueue financial outbox
events.

Last updated: 2026-09-02

## Architecture

```text
Stripe
  |
  | signed raw body
  v
StripeWebhookVerifier
  |
  | verified event
  v
Tenant/account resolver
  |
  v
InboxEvent(RECEIVED)
  |
  v
InboxWorker / processStripeInboxEvent
  |
  v
Canonical Payment / Refund
```

See [`stripe-webhook-normalization.md`](./stripe-webhook-normalization.md)
for snapshot application, stale/no-op, unknown references, and crash
atomicity.

The HTTP request itself does not execute financial business logic.
`InboxService.receive` is a single insert-or-detect operation against
PostgreSQL uniqueness. It is **not** wrapped in an outer interactive
transaction: a unique-constraint conflict (`P2002`) aborts a PostgreSQL
transaction, and duplicate Stripe deliveries must still resolve to
`DUPLICATE` / `CONFLICT` on the same connection.

```text
Stripe
   |
   | signed webhook HTTP POST
   v
FUP Stripe webhook endpoint
   |
   | verify raw body + signature
   v
Durable Inbox (RECEIVED)
   |
   | InboxWorker (source=stripe)
   v
Normalization — see stripe-webhook-normalization.md
```

HTTP ingestion still only verifies, resolves tenant, and persists the
inbox row. Canonical Payment/Refund mutation happens asynchronously in
the inbox processor. The generic **outbox** worker does not claim inbox
rows. Stripe financial processing uses a dedicated InboxWorker path.

## HTTP endpoint

```http
POST /api/v1/webhooks/stripe
```

There is no GET.

Authentication is **only** Stripe signature verification. The route is
not JWT-protected, not API-key-protected, not organization-header
authenticated, and there is no CSRF layer on this API.

The webhook signing secret is never an example in Swagger. The
controller is excluded from the OpenAPI document.

Successful acknowledgement:

```json
{ "received": true }
```

The body does not include `eventId`, organization id, inbox id, or
duplicate/conflict state. Stripe only needs `2xx`.

The endpoint is available only when `STRIPE_WEBHOOK_SECRET` is
configured. Missing configuration returns `503`
`PROVIDER_CONFIGURATION_ERROR`. Stripe enablement (`STRIPE_ENABLED`) is
independent: Connect can be enabled without webhook ingestion, and
webhook ingestion can be enabled without Connect.

## Raw-body signature verification

Stripe verifies HMAC over the **exact request bytes**. Parsing JSON and
re-serializing it (even with identical semantics, different whitespace
or key order) invalidates the signature.

NestJS is created with `bodyParser: false`. `configureApp` then:

1. Mounts `express.raw({ type: 'application/json', limit: '1mb' })`
   **only** on `/api/v1/webhooks/stripe` and copies the Buffer onto
   `req.rawBody`.
2. Leaves the existing `json({ limit: '1mb' })` parser for every other
   route.

The webhook controller never reads a parsed `req.body` and never calls
`JSON.stringify(req.body)` for verification.

The 1mb bound matches the rest of the API. Oversized bodies return
`413 PAYLOAD_TOO_LARGE` and are not persisted.

## Stripe verifier boundary

The Stripe SDK stays in `packages/provider-stripe`. `apps/api` imports
only:

```ts
verifyStripeWebhook({ rawBody, signature, secrets });
```

plus structured errors and the test-signature helper.

`verifyStripeWebhook` uses Stripe's official
`Stripe.webhooks.constructEvent` with the default **300 second**
timestamp tolerance. Timestamp tolerance is not disabled. Replay of an
old signed body fails at the signature layer; inbox dedup is an
additional defense, not a replacement.

Output is a plain JSON envelope (`VerifiedStripeWebhook`): `eventId`,
`eventType`, optional `accountId`, optional `apiVersion`, `livemode`,
optional `createdAt`, and `payload` (the parsed event object). The
public result is never a `Stripe.Event`.

Structured package errors:

| Package error                 | HTTP code / API code                   |
| ----------------------------- | -------------------------------------- |
| `StripeWebhookSignatureError` | `400 STRIPE_WEBHOOK_INVALID_SIGNATURE` |
| `StripeWebhookPayloadError`   | `400 STRIPE_WEBHOOK_INVALID_PAYLOAD`   |

Invalid or missing `Stripe-Signature` does not persist an inbox row,
does not write audit, and does not reveal the signing secret or
expected HMAC.

Malformed JSON after a cryptographically valid envelope does not
persist. The raw body is not logged.

## Trust transition

Signature verification happens at HTTP ingestion against the live raw
bytes.

The durable inbox stores the **verified parsed event JSON**, not the
raw byte body and not the `Stripe-Signature` header. Future financial
processing (Commit 18) trusts that inbox row. It does not re-verify
stored raw bytes.

Existence of an `InboxEvent` with `source = stripe` means the ingestion
boundary verified the Stripe signature. There is no public endpoint that
can insert `source=stripe` without that verifier. Status remains the
canonical `RECEIVED` — there is no `VERIFIED` status.

The signing secret is never persisted, logged, audited, or returned.

## Tenant / provider-account resolution

Connect snapshot events carry `event.account` when they belong to a
connected account. That identifier is the only tenant authority.

Do not infer organization from payment metadata, customer metadata, or
description.

Lookup:

```text
ProviderAccountConnection
  where provider = stripe
    and providerAccountId = event.account
```

The existing unique `(provider, providerAccountId)` index is sufficient.
No extra migration was added for lookup.

| Event shape                       | Inbox `organizationId` | `scopeKey` |
| --------------------------------- | ---------------------- | ---------- |
| No `account` (platform event)     | `null`                 | `platform` |
| Known connected account           | connection's org       | org UUID   |
| Signed event for unknown `acct_…` | `null`                 | `platform` |

Unknown connected accounts are **not** assigned to an arbitrary tenant.
They are persisted as platform-scoped forensic receipts because:

- the signature proves Stripe origin
- local `ProviderAccountConnection` timing can lag Stripe
- later processing must not mutate tenant state until the account is
  bound

A Stripe Event ID is provider identity. Tenant `scopeKey` is routing, not
identity. PostgreSQL enforces:

```text
Generic Inbox identity:
(scopeKey, source, externalEventId)

Stripe additional invariant:
(source='stripe', externalEventId) globally unique
```

via SQL-only partial unique index
`inbox_events_stripe_external_event_uidx`. The same `evt_…` cannot exist
as both a platform receipt and a tenant receipt.

If a valid event arrives for `acct_X` before a
`ProviderAccountConnection` exists, the first row may remain
`organizationId = null` / `scopeKey = platform`. A later verified
delivery of the **same** Event ID that resolves confidently to
organization A updates that row in place:

```text
organizationId: null → org-A
scopeKey: platform → org-A UUID
```

The verified JSON payload and `payloadHash` are never replaced. Known
tenant association is never downgraded back to platform. An anomalous
delivery that would move the row from organization A to organization B
is a routing conflict (`STRIPE_WEBHOOK_TENANT_CONFLICT` in logs): HTTP
still returns `2xx`, no second row is inserted, and the original
organization is retained.

### Commit 18 processing identity

Every Stripe Event ID exists at most once in `InboxEvent`. Processors may
use `InboxEvent.id` or `(source, externalEventId)` as durable
event-processing identity.

Tenant resolution is persisted on `InboxEvent` when it is known at ingest
or when a later verified duplicate delivery can promote unresolved →
known. Processors may still re-resolve `event.account` →
`ProviderAccountConnection` as a defense. They must not treat a second
inbox row as a second Stripe event.

## Durable Inbox mapping

Existing `InboxEvent` is reused. There is no Stripe-only webhook table.

| Field             | Value                                             |
| ----------------- | ------------------------------------------------- |
| `source`          | `stripe`                                          |
| `externalEventId` | Stripe Event ID (`evt_…`) — not hashed            |
| `eventType`       | Stripe `type` string (not a FUP payment state)    |
| `payload`         | verified event JSON object                        |
| `payloadHash`     | existing canonical JSON SHA-256                   |
| `status`          | `RECEIVED`                                        |
| `livemode`        | stored inside the event JSON (`payload.livemode`) |
| `api_version`     | preserved on the event; not rejected vs SDK pin   |

`event.created` is payload metadata only. It is **not** used for
ordering. Stripe does not guarantee delivery order.

The signature header is not part of the payload hash. The signing secret
is not stored.

### Payload storage boundary

Stripe objects generally do not contain raw PAN or CVC. Event payloads
can still contain PII (email, name, bank last-4, account requirements).
Inbox JSONB is the durable provider receipt, not ordinary application
metadata. Do not persist:

- PAN / CVC
- secret keys
- `Authorization`
- full KYC documents
- onboarding Account Link URLs

This commit persists the verified event JSON Stripe actually delivered.
Commit 18 must continue to avoid copying forbidden fields into domain
metadata or audit.

A minimal migration added `inbox_events.payload JSONB NOT NULL DEFAULT '{}'`
because Commit 7 stored only `payloadHash`. Durable webhook processing
requires the verified JSON. Hash semantics are unchanged.

## Duplicate / conflict semantics

Stripe retries. Duplicate delivery of the same Event ID is normal.

| Inbox result | HTTP                     | Persistence               |
| ------------ | ------------------------ | ------------------------- |
| `NEW`        | `200 { received: true }` | insert                    |
| `DUPLICATE`  | `200 { received: true }` | original row unchanged    |
| `CONFLICT`   | `200 { received: true }` | original payload retained |

Conflict (same Event ID, different canonical payload hash) is anomalous
and is detected **globally** for Stripe, regardless of `scopeKey`. The
original row stays authoritative. The second payload is not trusted
and is not stored. The endpoint still returns `2xx` so Stripe does not
retry forever a condition redelivery cannot fix. The API logs a warning
with safe identifiers only (`eventId`, `eventType`, `livemode`, outcome).

Invalid signature is **not** acknowledged as success. That returns `400`
and does not persist.

## Snapshot events

PaymentIntents remain v1 resources. Initial ingestion expects **snapshot
events** (the event includes the resource object). Thin/v2 events that
require a retrieve during processing are not introduced here.

Event destinations should later subscribe only to the types FUP needs.
The HTTP boundary does **not** reject unknown signed event types.
Forensic durability and upgrade tolerance come first. Commit 18 will
classify `SUPPORTED` / `IGNORED` / `UNKNOWN`.

Expected initial normalization set (document only; no handlers yet):

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `payment_intent.amount_capturable_updated`
- `payment_intent.requires_action` (optional)
- `refund.created`
- `refund.updated`
- `refund.failed`

Connect account lifecycle events may be persisted if Stripe delivers
them. This commit does **not** refresh `ProviderAccountConnection`
readiness from those payloads.

## Event destination operations

The application does **not** register Stripe Event Destinations at
startup.

Configure a snapshot-mode destination in Stripe Workbench (or
`stripe listen` for local development) pointing at:

```text
https://<api-host>/api/v1/webhooks/stripe
```

Use the destination signing secret as `STRIPE_WEBHOOK_SECRET`.

Local CLI:

```bash
stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe
```

The CLI prints a `whsec_…` secret. Put it in the process environment.
Never commit it.

Real sandbox proof for this commit used the authorized **default** Stripe
CLI profile (non-live; display name “Supplai sandbox”). The Frater Union
sandbox CLI profile credentials were expired (`test_mode_key_expires_at`
2026-06-24) and were not refreshed because login is interactive. Proof:

```text
stripe listen --forward-to localhost:<ephemeral>/api/v1/webhooks/stripe
stripe trigger payment_intent.succeeded
→ HTTP 2xx
→ InboxEvent RECEIVED, source=stripe, scopeKey=platform, livemode=false
```

No live mode. The CLI signing secret was not committed.

Rolling secrets: set `STRIPE_WEBHOOK_SECRET` to the new secret and
`STRIPE_WEBHOOK_SECRET_PREVIOUS` to the retiring one, then deploy.
Secrets live in config, not the database.

## Transaction and timing

```text
verify outside DB
resolve provider account from event.account only
receive inbox event (insert or detect duplicate/conflict globally for stripe)
if this delivery resolved a tenant, promote an unresolved platform row in place
return 2xx
```

No Stripe retrieve, Payment/Refund mutation, ledger, email, outgoing
webhook, or worker execution happens before acknowledgement.

## Audit and outbox

Webhook receipt does **not** write `AuditLog`. Audit is for tenant
business mutations. Receipt provenance is the inbox row.

Webhook receipt does **not** enqueue `OutboxEvent`.

## Logging

Allowed: `requestId`, `provider=stripe`, `eventId` after verification,
`eventType`, `NEW`/`DUPLICATE`/`CONFLICT`, routing
`assigned`/`unchanged`/`tenant_conflict`, resolved `organizationId`,
`attemptedOrganizationId` on tenant conflict, `connectionId`,
`livemode`, `unresolvedAccount`, and `STRIPE_WEBHOOK_TENANT_CONFLICT`
as a log `errorCode` (not an HTTP error).

Never: raw body, `Stripe-Signature`, `whsec_…`, full event object,
customer email, payment method, `client_secret`, KYC, onboarding URLs,
or `providerAccountId` when `connectionId` is enough.

`pino` redacts `req.headers["stripe-signature"]`, `req.rawBody`,
`*.stripeWebhookSecret`, and `*.stripeWebhookSecretPrevious`.

## Livemode and API version

`livemode` is preserved. Test events (`livemode=false`) are accepted;
sandbox depends on them. This commit does not add a live/test endpoint
mode mismatch guard.

Stripe event `api_version` is preserved. Ingestion does not reject older
event versions solely because the adapter is pinned to
`2026-08-26.dahlia`. Commit 18 decides parsing compatibility.

## Related documents

- [`event-delivery.md`](./event-delivery.md)
- [`stripe-provider-adapter.md`](./stripe-provider-adapter.md)
- [`stripe-connect.md`](./stripe-connect.md)
- [`security-boundaries.md`](./security-boundaries.md)
