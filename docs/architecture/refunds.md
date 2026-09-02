# Refunds persistence

Authoritative description of the persisted FraterUnion Payments refund
aggregate, refund capacity reservation, and create/get/list API.
Implemented in `packages/database` (schema) and `apps/api/src/refunds`.
Domain rules remain in `@fraterunion-payments/payment-core`.

Last updated: 2026-09-02

## Canonical refund vs provider execution

```text
Client
  ↓ POST /payments/:paymentId/refunds
FUP creates canonical Refund
  ↓
CREATED   ← internal request; money has not moved externally

Future orchestration:
Refund
  ↓
Provider adapter
  ↓
External provider
  ↓
normalized observation
  ↓
internal lifecycle transition (PROCESSING / SUCCEEDED / FAILED)
```

A persisted `Refund` is a FraterUnion Payments object. It is not a Stripe
Refund or any other provider-native object. Provider IDs are not stored
on the refund row. A later execution/mapping model can attach provider
attempts without assuming one refund equals one provider object forever.

This commit does **not** call any provider contract method.

`CREATED` means FraterUnion accepted a refund request and reserved
capacity. It does **not** mean money was refunded externally.

## Architecture

```text
Organization
  └── Payment
        └── Refund
```

```text
payment-core
    ↓ domain rules

application/API
    ↓ orchestration (lock Payment, then Refund)

database
```

Rows are rehydrated through `toDomainRefund` / `toDomainPayment` before
any transition. Callers cannot assign `status` freely. There is no public
lifecycle mutation endpoint.

## Money storage and transport

PostgreSQL `BIGINT` stores integer minor units. Prisma exposes `BigInt`.
API JSON uses decimal strings (`"5000"`). Currency is **not** accepted on
create — it is copied from the parent Payment while that row is locked.

## Capacity reservation

This is stronger than `Payment.refundedAmount <= Payment.capturedAmount`.

Statuses that consume refund capacity:

```text
CREATED
PROCESSING
SUCCEEDED
```

`FAILED` does **not** consume capacity. A failed refund releases its
reservation automatically because capacity queries exclude `FAILED`.

```text
reservedRefundAmount =
  SUM(refund.amount WHERE status IN CREATED, PROCESSING, SUCCEEDED)

availableRefundAmount =
  payment.capturedAmount - reservedRefundAmount
```

`Payment.refundedAmount` is **successfully refunded amount only** (sum of
`SUCCEEDED` refunds). Pending/in-flight requests are not stored on the
payment row.

Example:

```text
Payment captured: 10,000

Refund A CREATED: 3,000
successful refunded: 0
reserved: 3,000
available: 7,000

Refund A SUCCEEDED:
successful refunded: 3,000
reserved: 3,000
available: 7,000
Payment → PARTIALLY_REFUNDED
```

Then:

```text
Refund B CREATED: 7,000
available: 0

Refund B SUCCEEDED:
Payment.refundedAmount → 10,000
Payment → REFUNDED
```

Creating an 8,000 refund while A is still `CREATED` is rejected even
though `Payment.refundedAmount` is still `0`.

## Refundable payment states

Refund creation is allowed only when `payment-core`
`isRefundablePaymentState` is true:

```text
SUCCEEDED
PARTIALLY_REFUNDED
```

`REFUNDED` is rejected (capacity is zero). Pre-success states
(`CREATED`, `AUTHORIZING`, `AUTHORIZED`, `CAPTURING`, `FAILED`,
`CANCELED`) are rejected even if captured amounts were somehow nonzero.

## Payment projection on success

When a refund transitions to `SUCCEEDED`, the same transaction:

1. Locks Payment, then Refund.
2. Applies `succeedRefund` and `applyRefund` from payment-core.
3. Increments `Payment.refundedAmount`.
4. Derives `SUCCEEDED` / `PARTIALLY_REFUNDED` / `REFUNDED` via
   `derivePaymentRefundState` (through `applyRefund`).
5. Writes `refund.succeeded` and, when the payment aggregate changes,
   `payment.partially_refunded` or `payment.refunded`.

Failed refunds never decrement `Payment.refundedAmount`. A failed refund
object stays `FAILED`; a retry is a new Refund with a new idempotency
key.

## Concurrency and lock order

Canonical lock order, always:

```text
Payment first
Refund second
```

Refund creation:

```text
BEGIN
SELECT payment FOR UPDATE
resolve idempotency binding (replay or conflict)
validate refundable state + reserved capacity
INSERT refund
INSERT idempotency record
write audit
COMMIT
```

Because every create/transition for the same payment locks the parent
row, concurrent reservations serialize. Two `7000` creates against
`captured = 10000` yield one refund and one
`REFUND_AMOUNT_EXCEEDS_AVAILABLE`.

No optimistic `version` column. No `SELECT SUM` then `INSERT` outside
the payment lock.

## Idempotency

This commit generalizes the former narrow
`payment_create_idempotency_keys` table into `idempotency_records`:

```text
(organizationId, scope, keyHash) unique
scope = payment.create | refund.create
resourceType + resourceId bind the durable aggregate
requestFingerprint = SHA-256 of canonical payload
```

Existing payment-create rows are copied with `scope = payment.create`
before the old table is dropped. Raw `Idempotency-Key` values are
hashed, not stored. Records currently remain indefinitely.

Refund create fingerprint:

```text
organizationId
paymentId
amount
reason
metadata
```

Replay of an identical key returns the original Refund **before**
capacity is re-checked. A later reservation that consumes remaining
capacity must not turn a legitimate replay into
`REFUND_AMOUNT_EXCEEDS_AVAILABLE`. Same key + different payload is
`409 IDEMPOTENCY_KEY_CONFLICT`.

Concurrent same-key creates: unique index plus in-transaction lookup
after the payment lock. The loser rolls back and replays.

Capture/cancel/provider-operation scopes remain for a later
`feat(idempotency): add idempotent financial operations` hardening
commit (retention, recovery, additional mutation scopes). This commit
does not keep artificial work just to preserve roadmap numbering.

## Public vs internal operations

Public tenant API:

```text
POST /api/v1/payments/:paymentId/refunds
GET  /api/v1/payments/:paymentId/refunds
GET  /api/v1/refunds
GET  /api/v1/refunds/:refundId
```

`POST` requires `Idempotency-Key`. Nested list returns
`REFUND_PAYMENT_NOT_FOUND` for a foreign payment id (not an empty
list). Amounts are minor-unit decimal strings. No currency input.

Internal service methods (tests and future orchestration only):

```text
beginRefundProcessing
succeedRefund
failRefund
getRefundCapacity
```

There is no public `POST /refunds/:id/succeed` (or process/fail). Those
would let clients claim money moved externally.

Human JWT:

| Action | Roles                                     |
| ------ | ----------------------------------------- |
| Read   | OWNER, ADMIN, DEVELOPER, ANALYST, SUPPORT |
| Write  | OWNER, ADMIN, DEVELOPER                   |

DEVELOPER is included for consistency with payment creation: developers
already create payments and typically automate refunds via API keys.
ANALYST and SUPPORT cannot create refunds.

API key scopes: `refunds:read`, `refunds:write`. Refunds are a distinct
privileged financial action and do not inherit `payments:write`.

## Customer relation

Refunds do not duplicate `customerId`. Customer association is derived
through Payment. Customer archive does not delete refunds. Organization
and Payment deletion is `RESTRICT` while refunds exist. There is no
refund DELETE endpoint.

## Audit and deferred outbox

Every mutation writes audit in the same transaction:

```text
refund.created
refund.processing_started
refund.succeeded
refund.failed
payment.partially_refunded
payment.refunded
```

Safe metadata only: ids, status, currency, amount strings, reason,
normalized failure category/code, payment refunded amount / status. No
description dumps, refund metadata contents, raw provider payloads, or
secrets.

**Outbox emission is deferred.** The production worker has no refund or
payment-refund consumer. Enqueueing `refund.*` /
`payment.partially_refunded` / `payment.refunded` today would
dead-letter. Event emission belongs with provider orchestration.

## Failure persistence

`FAILED` requires `failure_category`, a non-empty `failure_message`, and
`failure_retryable`. Non-FAILED rows must have all failure columns NULL.
Values come from `createPaymentFailure` — not raw provider exceptions.
