# Event delivery

Authoritative description of the transactional outbox, durable inbox, and
outbox worker. Implementation lives in
[`packages/events`](../../packages/events/README.md) and
[`apps/worker`](../../apps/worker/README.md). This document follows
[ADR-007](../decisions/ADR-007-transactional-outbox-and-inbox.md).

Last updated: 2026-09-02

## Delivery semantics

The platform guarantees **at-least-once delivery**.

It does **not** claim exactly-once delivery. A handler may execute more
than once after a crash, a retry, a lease expiry, or a duplicate inbound
message. Correctness comes from:

- transactional persistence of the outbox or inbox row
- a stable event identity
- idempotent consumers
- durable inbox deduplication
- bounded retries
- `SELECT … FOR UPDATE SKIP LOCKED` claiming
- an explicit terminal `FAILED` state

Exactly-once would require distributed consensus across every producer,
worker, and external provider. That is not a guarantee this system makes.

## Why two tables

The **transactional outbox** is for events FraterUnion Payments produces
when it changes internal state. The business mutation and the outbox
insert share one PostgreSQL transaction. Only after commit may a worker
claim the row.

The **durable inbox** is for events a consumer receives that may arrive
more than once. The consumer durably claims identity
`(scopeKey, source, externalEventId)` before side effects. Stripe inbound
events additionally claim `(source='stripe', externalEventId)` globally.

Do not conflate the two. Publishing and inbound deduplication are
different problems.

Do not conflate either table with `AuditLog`. Audit answers who did what,
where, and when. Outbox/inbox answer what another component may need to
process. `AuditService` does not enqueue outbox events. The same
transaction client can still write a domain mutation, an audit row, and
an outbox event together. See
[`audit-logging.md`](./audit-logging.md).

## Transactional outbox

```text
BEGIN
  business mutation
  outbox event insert
COMMIT

worker claims (separate short transaction)
handler runs (no open database transaction)
success / retry / failure (separate transaction)
```

`OutboxService.enqueue(client, input)` accepts the open Prisma
transaction client. It must not open a nested transaction. The future
invariant is:

```text
business state committed  IFF  corresponding outbox event committed
```

### Organization ownership

`organizationId` is nullable. Tenant-owned events set it explicitly
(ADR-003). Genuine platform/system events leave it null. The
infrastructure does not invent a fake tenant.

### Event type and aggregate

`eventType` is a stable string such as `auth.example`. Domain packages
own their names; this infrastructure does not define payment event
constants.

`aggregateType` and `aggregateId` identify the logical source entity when
one exists. They are nullable and have **no foreign keys** to future
domain tables.

### Payload and metadata

`payload` is immutable JSONB event data. `metadata` is reserved for safe
operational context (schema version, request ID, non-secret actor IDs,
trace information). Neither field is a secret store. Never persist
passwords, password hashes, JWTs, refresh tokens, API-key secrets or
hashes, provider credentials, PAN, or CVC.

### Correlation vs causation

- **correlationId** groups events and actions that belong to the same
  broader operation or trace.
- **causationId** identifies the event or message that directly caused
  this event.

Neither is required. A request ID may be copied into metadata or used as
a correlation hint; it is not automatically the same thing as
`correlationId`.

### Identity

Every outbox row gets an immutable UUIDv7 primary key at insert. Retries,
processing, failure, and future replay keep that same ID. Downstream
inbox deduplication will use it as the external event identifier.

## Outbox statuses

| Status       | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `PENDING`    | Eligible when `availableAt <= now`.                                      |
| `PROCESSING` | Claimed. Must have `claimedAt`, `claimExpiresAt`, and `claimedBy`.       |
| `PROCESSED`  | Handler succeeded. Must have `processedAt`.                              |
| `FAILED`     | Terminal after a non-retryable error or exhausted attempts. Dead letter. |

`FAILED` rows are never deleted. Manual replay UI/API is deferred.

## Claiming, leases, and `SKIP LOCKED`

Multiple worker instances claim concurrently without normally taking the
same row:

```sql
SELECT id, status
FROM outbox_events
WHERE (
  (status = 'PENDING' AND available_at <= now)
  OR (status = 'PROCESSING' AND claim_expires_at <= now)
)
ORDER BY available_at ASC, created_at ASC
LIMIT $batch
FOR UPDATE SKIP LOCKED
```

inside a short transaction that then marks the locked rows `PROCESSING`
and sets the lease. The claim transaction commits **before** the handler
runs. An optional `eventTypePrefix` can scope a claimer to
`event_type LIKE prefix%` (used by tests so they do not consume each
other's rows). Production workers omit it and claim the global queue.

Default lease: **60 seconds** (`WORKER_CLAIM_LEASE_MS`). Expired
`PROCESSING` rows are reclaimable. There is no heartbeat in this commit.
Handlers must not normally exceed the lease. Long-running work will later
need lease extension.

Implication of a crash: the row stays `PROCESSING` until `claimExpiresAt`,
then another worker may reclaim it. The first handler, if it later
resumes, must still be idempotent.

## Retry policy

Defaults:

```text
max attempts: 10
base delay:   1 second
maximum delay: 15 minutes
```

Backoff is exponential with **full jitter**:

```text
delay = floor(random() * min(maxDelay, baseDelay * 2^attempt))
```

`random` is injectable so tests stay deterministic. After the attempt
budget is exhausted, `status = FAILED`. The platform does not retry
forever.

Classification is typed, not inferred from message strings:

| Failure                         | Class                            |
| ------------------------------- | -------------------------------- |
| `RetryableEventError`           | retryable                        |
| unexpected / dependency failure | retryable until budget exhausted |
| `TerminalEventError`            | terminal immediately             |
| unknown event type              | terminal (`UNKNOWN_EVENT_TYPE`)  |
| schema / validation mismatch    | terminal                         |

Unknown handlers are configuration failures. Retrying them ten times
would only delay the dead letter.

## Durable inbox

```text
receive event
→ identify scope + source + externalEventId
→ durable inbox claim
→ process idempotently
→ mark processed
```

### Identity and uniqueness

Preferred identity is tenant-scoped:

```text
organizationId + source + externalEventId
```

SQL `NULL != NULL`, so a nullable `(organizationId, source, externalEventId)`
unique constraint would allow duplicate platform events. Inbox rows
therefore have a non-null `scopeKey`:

- tenant events: `scopeKey = organizationId` (UUID text)
- platform/system events: `scopeKey = 'platform'` and `organizationId` is
  null

A CHECK constraint keeps those two representations consistent. Generic
uniqueness is `(scopeKey, source, externalEventId)`.

Stripe Event IDs are additionally globally unique. A Stripe `evt_…` is
provider event identity; tenant `scopeKey` is routing, not identity:

```text
Generic Inbox identity:
(scopeKey, source, externalEventId)

Stripe additional invariant:
(source='stripe', externalEventId) globally unique
```

SQL-only partial unique index `inbox_events_stripe_external_event_uidx`
enforces the Stripe invariant without changing other sources. Same
external id across two tenants remains allowed for generic sources.
`InboxService.receive` reloads globally when a Stripe unique conflict
fires. An unresolved connected-account receipt may persist as
platform-scoped and later promote `organizationId` / `scopeKey` in place
when a verified duplicate delivery resolves a tenant. Known tenant
association is never downgraded to platform and never silently moved to
another organization.

The full inbound payload **is** stored on `InboxEvent.payload` as JSONB
(object only). Commit 7 originally hashed without persisting the body;
Stripe webhook ingestion needs the verified event JSON for later
normalization. `payloadHash` remains the SHA-256 of canonical JSON and
is still the conflict detector. See
[`stripe-webhook-ingestion.md`](./stripe-webhook-ingestion.md).

### Receive results

| Result      | Meaning                                         |
| ----------- | ----------------------------------------------- |
| `NEW`       | First durable receipt of this identity.         |
| `DUPLICATE` | Same identity and same payload hash.            |
| `CONFLICT`  | Same identity and a **different** payload hash. |

A conflict does not overwrite the original hash. It is an anomaly, not a
normal duplicate. Concurrent first receipts serialize on the unique
constraint (and, for Stripe, the additional global Event ID index): one
`NEW`, the rest `DUPLICATE` or `CONFLICT`.

### Canonical JSON hashing

Hashing uses SHA-256 over a small canonical JSON serializer:

- object keys are sorted recursively
- array order is preserved
- `undefined`, functions, symbols, bigint, and non-finite numbers are
  rejected

`{"a":1,"b":2}` and `{"b":2,"a":1}` produce the same hash. `[1,2]` and
`[2,1]` do not.

### Inbox statuses

`RECEIVED` → `PROCESSING` → `PROCESSED`, or `FAILED` after a terminal
error / exhausted retries. A retryable inbox failure returns the row to
`RECEIVED` with `availableAt` backoff. `UNRESOLVED_EXTERNAL_REFERENCE`
(missing provider execution) is retryable, not terminal. `beginProcessing`
and `claimBatch` only take eligible `RECEIVED` rows (or expired
`PROCESSING` leases). A `PROCESSED` row cannot start logical processing
again.

Claim fields (`claimedAt`, `claimExpiresAt`, `claimedBy`, `availableAt`,
`processingOutcome`) support `FOR UPDATE SKIP LOCKED` leasing. Stripe
financial application, audit, and `PROCESSED` commit in one transaction.
See [`stripe-webhook-normalization.md`](./stripe-webhook-normalization.md).

## Transaction composition

Future consumers must be able to combine, in one PostgreSQL transaction:

```text
BEGIN
  claim / check inbox event
  domain mutation
  enqueue resulting outbox event
  mark inbox processed
COMMIT
```

Inbox and outbox APIs accept the transaction client. They do not hide a
second transaction. Rollback leaves none of those writes committed.

## Worker

`apps/worker` polls PostgreSQL. It does not use Redis, BullMQ, Kafka, or
SQS.

The process runs two pollers:

- `OutboxWorker` — existing outbound events (empty production registry)
- `InboxWorker` — `source='stripe'` financial normalization only

Unknown Stripe event types are processed as ignored no-ops, not
dead-lettered. Inbox processing does not go through the outbox handler
registry.

Lifecycle: validate environment → connect → unique worker ID → poll both
queues → claim bounded batches → dispatch → mark success/retry/failure →
recover expired claims → sleep → on SIGTERM/SIGINT stop both workers,
wait for in-flight work up to `WORKER_SHUTDOWN_TIMEOUT_MS`, disconnect,
exit.

Tick results are structured (`claimed`, `processed`, `retried`,
`failed`, `reclaimed`) so future metrics can count them. This commit does
not add Prometheus or an external telemetry pipeline.

## Retention, replay, and metrics

Processed and failed rows stay durable. There is no automatic cleanup
cron in this commit. Retention policy, manual replay, and metrics backends
are deferred.

## Security

The event substrate is **not** a secure secret transport.

Never put secrets in `payload`, `metadata`, `lastErrorMessage`, or worker
logs. Operational error columns store a bounded, redacted first line
(connection strings, bearer tokens, JWTs, API-key-shaped values, and
`password=` / `secret=` assignments are replaced). Stack traces stay in
the redacted process logger, not in the database.

Worker logs include service, worker ID, event ID, event type,
organization ID, attempt, outcome, and duration. They do not log payloads
by default.

See [security boundaries](./security-boundaries.md) and
[ADR-005](../decisions/ADR-005-no-raw-card-data.md).
