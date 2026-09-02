# @fraterunion-payments/worker

Standalone Node.js process that polls PostgreSQL for the transactional
outbox **and** Stripe inbox events. It is not a Redis, BullMQ, Kafka, or
SQS worker. See
[`docs/architecture/event-delivery.md`](../../docs/architecture/event-delivery.md)
and [ADR-007](../../docs/decisions/ADR-007-transactional-outbox-and-inbox.md).

Outbox production still starts with an **empty** handler registry.
InboxWorker claims `source=stripe` only and runs
`processStripeInboxEvent`. Ignored Stripe types become processed no-ops.
Financial mutation, audit, and Inbox `PROCESSED` commit in one
transaction. See
[`docs/architecture/stripe-webhook-normalization.md`](../../docs/architecture/stripe-webhook-normalization.md).

## Lifecycle

1. Validate environment.
2. Connect to PostgreSQL and run `SELECT 1`.
3. Generate a unique worker ID.
4. Poll for eligible outbox **and** Stripe inbox rows.
5. Claim a bounded batch with `FOR UPDATE SKIP LOCKED`.
6. Dispatch each claimed outbox event to the registered handler, or
   process each claimed Stripe inbox event through the financial
   normalizer (no second PROCESSED mark on success).
7. Mark processed, schedule a retry, or mark `FAILED`.
8. Expired `PROCESSING` leases are reclaimable on the same claim path.
9. Sleep `WORKER_POLL_INTERVAL_MS` when idle (no empty-queue info logs).
10. On `SIGTERM` / `SIGINT`: stop claiming, wait for in-flight handlers
    up to `WORKER_SHUTDOWN_TIMEOUT_MS`, disconnect, exit.

Unfinished work is not marked successful. Abandoned claims become
eligible again when `claimExpiresAt` passes. Handlers must not normally
exceed the claim lease (default 60s). Heartbeats are deferred.

## Configuration

| Variable                     | Default       | Constraint                            |
| ---------------------------- | ------------- | ------------------------------------- |
| `DATABASE_URL`               | —             | Required `postgresql://` URL          |
| `NODE_ENV`                   | `development` | `development` / `test` / `production` |
| `LOG_LEVEL`                  | `info`        | Shared log levels                     |
| `WORKER_POLL_INTERVAL_MS`    | `1000`        | 100–60_000                            |
| `WORKER_BATCH_SIZE`          | `25`          | 1–500                                 |
| `WORKER_CLAIM_LEASE_MS`      | `60000`       | 1_000–3_600_000                       |
| `WORKER_MAX_ATTEMPTS`        | `10`          | 1–100                                 |
| `WORKER_RETRY_BASE_MS`       | `1000`        | ≥ 100                                 |
| `WORKER_RETRY_MAX_MS`        | `900000`      | ≥ retry base, ≤ 1 hour                |
| `WORKER_CONCURRENCY`         | `5`           | 1–100                                 |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | `30000`       | 1_000–300_000                         |

Validation errors do not echo `DATABASE_URL`.

## Logging

Structured logs include `service`, `workerId`, `eventId`, `eventType`,
`organizationId`, `attempt`, `outcome`, and `durationMs`. Payloads and
secrets are never logged by default. Idle polls that claim zero rows do
not emit a batch line.

## Commands

From the repository root (after `pnpm build` so workspace packages
resolve):

```bash
pnpm --filter @fraterunion-payments/worker run dev
pnpm --filter @fraterunion-payments/worker run start
pnpm --filter @fraterunion-payments/worker run test
```

`start` runs `node dist/main.js`. Provide `DATABASE_URL` in the
environment or in `packages/database/.env` (loaded if present, never
committed).
