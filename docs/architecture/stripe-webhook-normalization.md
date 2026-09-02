# Stripe webhook normalization

Turns a verified Stripe `InboxEvent(RECEIVED)` into canonical Payment /
Refund mutations. Stripe remains an observation source. Stripe event
type names never persist on Payment or Refund.

Last updated: 2026-09-02

## Pipeline

```text
Stripe evt
   |
   v
InboxEvent
   |
   v
Stripe normalizer (provider-stripe)
   |
   v
Provider observation
   |
   +---- PaymentProviderExecution / RefundProviderExecution lookup
   |
   v
payment-core / refund-core
   |
   v
Payment / Refund + AuditLog + InboxEvent(PROCESSED)
```

Provider IDs stop at `PaymentProviderExecution` /
`RefundProviderExecution`. See
[`provider-payment-executions.md`](./provider-payment-executions.md).

Signature verification and inbox receipt stay in
[`stripe-webhook-ingestion.md`](./stripe-webhook-ingestion.md). This
document is the processing half.

## Supported Stripe event types

PaymentIntent snapshots (object `payment_intent`):

- `payment_intent.amount_capturable_updated`
- `payment_intent.processing`
- `payment_intent.requires_action`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`

Refund snapshots (object `refund`):

- `refund.created`
- `refund.updated`
- `refund.failed`

`payment_intent.created` is **ignored**. Canonical Payments already
exist before provider execution. Other types (`customer.updated`,
`charge.succeeded`, `account.updated`, `charge.refund.updated`, …) are
ignored no-ops. They are marked `PROCESSED` with outcome
`IGNORED_EVENT_TYPE`, not `FAILED`.

Event type classifies whether we understand the envelope. The contained
object snapshot determines observed provider state. Do not implement
`if type === payment_intent.succeeded then status = SUCCEEDED`.

## Normalization boundary

`normalizeStripeFinancialEvent` lives in
`@fraterunion-payments/provider-stripe`. `apps/api` never sees
`Stripe.PaymentIntent` or `Stripe.Refund`.

The contained PaymentIntent uses the same
`observeStripePaymentIntent({ operation: 'retrieve' })` mapper as
`retrievePayment()`. Refund snapshots use `observeStripeRefund`.

Account context comes from verified `event.account` only — never from
PaymentIntent metadata.

`pi_…` / `re_…` shape is validated only inside the Stripe normalizer.
Canonical execution tables treat ids as opaque strings.

Structural parsing (required snapshot fields) is the compatibility
check. A different `api_version` is accepted when the needed fields are
present. Missing shape is `UNSUPPORTED_PROVIDER_EVENT_VERSION` or
`MALFORMED_PROVIDER_OBJECT`.

## Observation application

`applyPaymentProviderObservation` / `applyRefundProviderObservation` in
`payment-core` are provider-neutral. They return:

| Kind                   | Meaning                                            |
| ---------------------- | -------------------------------------------------- |
| `APPLIED`              | Canonical state changed through domain transitions |
| `NOOP_ALREADY_CURRENT` | Same state and amounts                             |
| `NOOP_STALE`           | Older / non-regressive observation                 |
| `ANOMALY`              | Contradiction; do not mutate                       |

Fast-forward: a snapshot may skip intermediate webhooks. The helper
walks legal domain functions (`beginAuthorization` →
`applyAuthorization` → `beginCapture` → `applyCapture`) in one
operation. It never assigns status directly.

Monetary monotonicity: authorized, captured, and refunded amounts never
decrease. A later snapshot with a smaller captured amount is stale.

Terminal protection: `FAILED` / `CANCELED` are not resurrected into
success. `SUCCEEDED` / `REFUNDED` family states are not regressed by
older processing or failure snapshots.

### Payment snapshot → canonical

| Stripe snapshot                             | Canonical                                             |
| ------------------------------------------- | ----------------------------------------------------- |
| `requires_capture` (manual)                 | `AUTHORIZED` (authorized = capturable + received)     |
| `succeeded` with `amount_received > 0`      | `SUCCEEDED` (fast-forward allowed)                    |
| `requires_action` / `requires_confirmation` | `REQUIRES_ACTION`                                     |
| `requires_payment_method`                   | `REQUIRES_PAYMENT_METHOD` — **not** terminal `FAILED` |
| `canceled`                                  | `CANCELED`                                            |
| `processing` + `capture_method=manual`      | `AUTHORIZING`                                         |
| `processing` + `capture_method=automatic`   | `CAPTURING`                                           |

`processing` uses `capture_method` on the snapshot via the retrieve
mapper. The webhook processor does not guess the original adapter
operation. Conclusive events (`succeeded`, `requires_capture`,
`canceled`) matter more than forcing every transient state.

`payment_intent.payment_failed` is **not** terminal `FAILED` when the
snapshot is `requires_payment_method`. Stripe still expects another
method on the same PaymentIntent. Canonical `FAILED` is reserved for
genuinely terminal execution.

Automatic-capture Payments must not observe `AUTHORIZED`
(`AUTHORIZED_ON_AUTOMATIC_CAPTURE` anomaly).

Do not infer refunds from PaymentIntent or charge refunded fields.
Refund authority is `RefundProviderExecution` + refund events.

### Refund snapshot → canonical

| Stripe snapshot               | Canonical                              |
| ----------------------------- | -------------------------------------- |
| `pending` / `requires_action` | `PROCESSING`                           |
| `succeeded`                   | `SUCCEEDED` (CREATED may fast-forward) |
| `failed` / `canceled`         | `FAILED`                               |

Provider refund amount and currency must equal the canonical Refund.
Mismatch is an anomaly; the canonical amount is not rewritten.

When a refund **transitions into** `SUCCEEDED`, the same transaction
calls `applyRefund` on the locked Payment exactly once. A later
`refund.updated` with the same succeeded snapshot is
`NOOP_ALREADY_CURRENT` and must not increment `refundedAmount` again.

A stale `refund.failed` after `SUCCEEDED` is `NOOP_STALE`. There is no
reversal: `refundedAmount` does not decrease.

Capacity reservation remains derived from Refund states
(`CREATED` + `PROCESSING` + `SUCCEEDED`). `FAILED` releases unused
reservation. Webhook processing does not maintain a separate counter.

## Unknown provider objects

A valid signed event may reference `pi_unknown` / `re_unknown` with no
execution row. Processing:

- does **not** create a Payment or Refund
- does **not** read metadata for identity
- throws retryable `UNRESOLVED_EXTERNAL_REFERENCE`
- returns the Inbox row to `RECEIVED` with `availableAt` backoff and
  outcome `UNRESOLVED_REFERENCE`

This is not `FAILED`. Later orchestration can bind the execution and
retry the **same** InboxEvent.

## Account and tenant invariants

Lookup is `(provider, providerAccountScope, providerPaymentId)` (or
refund id). Platform events resolve only `default` executions.
Connected-account events resolve only matching `acct:` scope.

If the same opaque provider id exists under a **different** account
scope, processing is terminal
`PROVIDER_EXECUTION_ACCOUNT_MISMATCH`.

If Inbox `organizationId` is set and disagrees with the execution
tenant, same terminal mismatch. Platform-scoped inbox rows may be
promoted to the execution's organization when the reference resolves.

## Inbox processing and worker

There is no parallel `stripe_webhook_processing` table. The Inbox row is
the durable processing record.

`apps/worker` runs `OutboxWorker` and `InboxWorker` in one process.
InboxWorker claims `source='stripe'` with `FOR UPDATE SKIP LOCKED`:

```text
RECEIVED AND available_at <= now
OR PROCESSING with expired claim lease
```

Claim is a short transaction. The handler then opens the apply
transaction. No Stripe API call is made while processing; only the
persisted inbox snapshot is read.

### Lock order (apply transaction)

```text
1. InboxEvent
2. Payment
3. Refund
```

Inbox is locked first only to confirm the claim is still
`PROCESSING`. Payment then Refund matches the existing refund API
(`Payment` first). RefundsService never locks Inbox, so the two paths
do not deadlock.

Concurrency across different Payments is allowed. The Payment row lock
serializes mutations for one Payment. There is no global event
partitioning.

### Crash atomicity

Financial mutation + audit + `InboxEvent(PROCESSED)` commit together.
A crash before commit leaves no Payment/Refund change. A crash after
commit means the inbox row is already `PROCESSED`. Retry of a
PROCESSED row is a no-op.

`markFailedOrRetry` only updates a `PROCESSING` row still claimed by
that worker, so a reclaiming worker that already applied cannot be
overwritten.

### Outcomes

Stored on `processing_outcome` when useful:

| Outcome                | Typical cause                           |
| ---------------------- | --------------------------------------- |
| `APPLIED`              | Canonical state changed                 |
| `NOOP_ALREADY_CURRENT` | Duplicate equivalent snapshot           |
| `NOOP_STALE`           | Non-regressive older snapshot           |
| `IGNORED_EVENT_TYPE`   | Unsupported / irrelevant type           |
| `UNRESOLVED_REFERENCE` | Retryable missing execution             |
| `ANOMALY`              | Terminal contradiction (`FAILED` inbox) |

Retryable: missing execution, unexpected internal errors, contention.
Terminal: tenant/account mismatch, currency/amount contradiction,
closed-state resurrection, malformed object.

## Audit

Audit is written only when canonical financial state changes. Actions
reuse existing vocabulary (`payment.succeeded`, `refund.succeeded`,
…). Safe metadata may include `source: provider_webhook`,
`provider: stripe`, `eventId` (`evt_…` is an operational identifier),
ids, old/new status, and amount strings. Full provider payloads are
never stored.

## Ledger and outbox

This commit writes **zero** ledger entries and does **not** enqueue
`payment.succeeded` / `refund.succeeded` outbox events. Ledger is the
next commit.

## Public API

`POST /payments` still does not call Stripe. There is no public
provider-execution or capture/cancel orchestration endpoint.
Normalization only applies to executions that already exist.
