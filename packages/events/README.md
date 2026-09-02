# @fraterunion-payments/events

Framework-independent transactional outbox and durable inbox. NestJS is
not a dependency. Delivery is **at-least-once**; consumers must be
idempotent. See
[`docs/architecture/event-delivery.md`](../../docs/architecture/event-delivery.md)
and [ADR-007](../../docs/decisions/ADR-007-transactional-outbox-and-inbox.md).

## Layout

```text
src/
  outbox/     enqueue, SKIP LOCKED claim, processed / retry / fail
  inbox/      receive (NEW / DUPLICATE / CONFLICT), processing transitions
  retry/      bounded exponential backoff with full jitter
  json/       canonical JSON for hashing
  hash/       SHA-256 payload digest
  sanitize/   bounded, redacted operational error text
  handlers/   one-handler-per-type registry
  types.ts
  errors.ts
  index.ts
```

## Outbox

```ts
await prisma.$transaction(async (tx) => {
  // future business mutation
  await outbox.enqueue(tx, {
    organizationId,
    eventType: 'auth.example',
    payload: {/* immutable, non-secret */},
  });
});

const { events, reclaimed } = await outbox.claimBatch(prisma, {
  workerId,
  batchSize: 25,
  claimLeaseMs: 60_000,
});
await outbox.markProcessed(prisma, events[0].id);
await outbox.markFailedOrRetry(prisma, events[0], error, { retryPolicy });
```

`enqueue` uses the client it is given. It does not open another
transaction.

Platform/system events omit `organizationId`. Tenant events set it.

Event IDs are UUIDv7 and never change on retry.

## Inbox

```ts
const result = await inbox.receive(tx, {
  organizationId,
  source: 'provider.example',
  externalEventId,
  eventType: 'events.example',
  payload,
});
// result.kind === 'NEW' | 'DUPLICATE' | 'CONFLICT'
```

Identity is `(scopeKey, source, externalEventId)` where `scopeKey` is the
organization UUID or `'platform'`. Same identity + same canonical hash is
a duplicate. Same identity + different hash is a conflict — the original
payload and hash are not overwritten.

`payload` is the verified inbound JSON object. Stripe webhook ingestion
stores the signed event JSON here after signature verification. See
[`docs/architecture/stripe-webhook-ingestion.md`](../../docs/architecture/stripe-webhook-ingestion.md).

## Defaults

```text
max attempts: 10
base delay:   1s
max delay:    15m
claim lease:  60s
```

Unknown event types throw `TerminalEventError` with code
`UNKNOWN_EVENT_TYPE`. Unexpected errors are retryable until the attempt
budget is exhausted.

## Security

Do not put secrets, tokens, or card data in payloads, metadata, or error
messages. `sanitizeErrorMessage` is a last-line defense for operational
columns, not a license to transport secrets.
