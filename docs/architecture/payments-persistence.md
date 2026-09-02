# Payments persistence

Authoritative description of the persisted FraterUnion Payments payment
aggregate and its application/API lifecycle. Implemented in
`packages/database` (schema) and `apps/api/src/payments`. Domain rules
remain in `@fraterunion-payments/payment-core`.

Last updated: 2026-09-02

## Canonical payment vs provider execution

```text
Client
  ↓ POST /payments
FUP creates canonical Payment
  ↓
CREATED

Future orchestration:
Payment
  ↓
Provider adapter
  ↓
External provider
  ↓
normalized observation
  ↓
internal lifecycle transition
```

A persisted `Payment` is a FraterUnion Payments object. It is not a
Stripe PaymentIntent, an Adyen payment, or a Moneris transaction.
Provider IDs and provider-specific statuses are not stored on the payment
row. `PaymentProviderExecution` attaches opaque provider payment objects
(`pi_…` for Stripe) without assuming one payment equals one provider
object forever. See
[`provider-payment-executions.md`](./provider-payment-executions.md).
Verified Stripe inbox events may mutate canonical Payment state through
payment-core observation application; see
[`stripe-webhook-normalization.md`](./stripe-webhook-normalization.md).
Public `POST /payments` still does **not** call
`PaymentProvider.createPayment()` or any other provider contract method.

## Architecture

```text
payment-core
    ↓ domain rules

application/API
    ↓ orchestration

database
```

Rows are rehydrated through `toDomainPayment` before any transition.
Callers cannot assign `status` freely. There is no public
`setStatus(...)` and no HTTP lifecycle mutation endpoint.

## Money storage and transport

PostgreSQL `BIGINT` columns store integer minor units (`requested_amount`,
`authorized_amount`, `captured_amount`, `refunded_amount`). Prisma exposes
these as `BigInt`. Application code never converts amounts to IEEE-754
floats.

API JSON uses decimal strings:

```json
{
  "amount": "12500",
  "currency": "USD"
}
```

`amount` is integer minor units encoded as a base-10 string.

```text
USD $125.00 → "12500"
MXN $125.00 → "12500"
```

Decimal strings (`"125.50"`) and JSON numbers (`125.50`) are rejected.
Responses serialize `requestedAmount` / `authorizedAmount` /
`capturedAmount` / `refundedAmount` the same way. Never
`JSON.stringify` a `bigint`.

Currency is a single uppercase ISO 4217 code on the payment row.
Application validation uses `payment-core` (`canonicalizeCurrencyCode`).
PostgreSQL additionally checks `currency ~ '^[A-Z]{3}$'`.

Database CHECKs:

```text
requested_amount > 0
authorized_amount >= 0
captured_amount >= 0
refunded_amount >= 0
refunded_amount <= captured_amount
captured_amount <= authorized_amount
authorized_amount <= requested_amount
SUCCEEDED / PARTIALLY_REFUNDED / REFUNDED → captured_amount > 0
```

## Lifecycle persistence

Persisted statuses match `payment-core` exactly:

```text
CREATED
REQUIRES_PAYMENT_METHOD
REQUIRES_ACTION
AUTHORIZING
AUTHORIZED
CAPTURING
SUCCEEDED
FAILED
CANCELED
PARTIALLY_REFUNDED
REFUNDED
```

`PARTIALLY_REFUNDED` and `REFUNDED` exist on the enum for alignment with
`payment-core`. Refund persistence, capacity reservation, and the public
refund API are implemented in
[`refunds.md`](./refunds.md). This payment commit still does not call
providers.

Creation starts in `CREATED` with authorized/captured/refunded amounts
equal to `0`. It does **not** enter `AUTHORIZING` — provider execution
has not happened.

### Public vs internal operations

Public tenant API:

```text
POST /api/v1/payments
GET  /api/v1/payments
GET  /api/v1/payments/:paymentId
```

Internal service methods (tests and future orchestration only):

```text
markRequiresPaymentMethod
beginAuthorization
markRequiresAction
resumeAuthorization
markAuthorized
beginCapture
markSucceeded
markFailed
cancelPayment
```

`markAuthorized` applies `payment-core` `applyAuthorization`:
`MANUAL` → `AUTHORIZED`, `AUTOMATIC` → `CAPTURING`.
`beginAuthorization` requires a payment method in the domain. Vaulting
is not implemented; the service attaches a transient `OTHER` method
reference in memory so the core transition can run. That reference is
not persisted.

There is no public `POST /payments/:id/succeed` or `/authorize`. Those
would let clients lie about financial state.

## Concurrency

Lifecycle updates use `SELECT ... FOR UPDATE` inside the same
transaction that rehydrates the domain, applies a `payment-core`
operation, persists the result, and writes audit.

No optimistic `version` column. Status-based domain transitions already
make a conflicting second update illegal once the winner commits. The
loser receives `PAYMENT_INVALID_TRANSITION`.

## Idempotent creation

Payment creation is financial and must be idempotent. Durable records live
on `idempotency_records` (unique `(organizationId, scope, keyHash)`), with
`scope = payment.create` and `resourceType = payment`. See
[`idempotency.md`](./idempotency.md) for the reusable financial-command
primitive, reserved mutation scopes, `IN_PROGRESS` / `COMPLETED`, and
provider-key derivation. Refund create is documented in
[`refunds.md`](./refunds.md).

The raw `Idempotency-Key` header is hashed, not stored. The fingerprint
is SHA-256 of canonically serialized, domain-separated:

```text
scope = payment.create
organizationId
customerId
requested amount
currency
captureMethod
description
metadata
```

Key order does not matter. Repeated identical requests return the same
payment. The same key with a materially different body returns
`409 IDEMPOTENCY_KEY_CONFLICT`. Concurrent same-key creates rely on the
unique index: exactly one payment row is committed; the loser replays
the winner after rollback.

Creation, the idempotency row, and audit share one transaction. A
failure before commit does not bind the key to a nonexistent payment.
Records currently remain indefinitely — no silent expiry.

## Customer relation

`customerId` is optional (guest/one-off checkout). When present:

- the customer must belong to the same organization
- archived customers cannot receive **new** payments
- historical payments remain readable after customer archive

PostgreSQL composite FK:

```text
(customerId, organizationId) → customers(id, organizationId)  RESTRICT
```

`MATCH SIMPLE` skips the check when `customerId` is NULL. Cross-tenant
attach is impossible at the database. Payment → Organization is also
`RESTRICT`. There is no payment DELETE endpoint and no physical deletion
service.

## Audit and deferred outbox

Every mutation writes audit in the same transaction:

```text
payment.created
payment.requires_payment_method
payment.authorization_started
payment.requires_action
payment.authorization_resumed
payment.authorized
payment.capture_started
payment.succeeded
payment.failed
payment.canceled
```

Safe metadata only: `paymentId`, `status`, `currency`, `captureMethod`,
minor-unit amount strings, `customerPresent`, and normalized failure
category/code. No description, payment metadata contents, raw provider
payloads, or secrets.

**Outbox emission is deferred.** The production worker's generic
registry has no payment-domain consumer. Enqueueing `payment.*` events
today would claim them and mark them `FAILED`. Event emission belongs
with provider orchestration and a concrete consumer.

## Failure persistence

`FAILED` requires `failure_category`, a non-empty `failure_message`, and
`failure_retryable`. Non-FAILED rows must have all failure columns NULL.
Messages and codes are bounded. Values come from
`createPaymentFailure` — not raw provider exceptions.
