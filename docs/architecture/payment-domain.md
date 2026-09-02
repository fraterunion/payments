# Payment domain

Authoritative description of the provider-neutral payment core in
`@fraterunion-payments/payment-core`. Persistence, provider adapters,
and HTTP are out of scope here.

Last updated: 2026-09-02

## Provider-neutral core

The domain language belongs to FraterUnion Payments. Adapters map
provider objects onto it. The core must not import a provider SDK and
must not contain Stripe-shaped fields (`stripePaymentIntentId`,
`requires_capture`, `pi_…`, and so on).

Abstract provider identifiers (`provider`, `providerPaymentId`,
`providerCustomerId`) exist only as boundary types
(`ProviderPaymentReference`, `ProviderCustomerReference`). They are
not fields on `Payment`.

## Money

`Money` is `{ amount: bigint, currency: CurrencyCode }`.

- Integer minor units, no floats (ADR-009).
- `bigint` avoids `Number.MAX_SAFE_INTEGER` for large minor-unit totals
  (for example high-value JPY).
- Currency is required, uppercase, exactly three ASCII letters, and
  must be an accepted ISO 4217 payment code (ADR-010). Precious-metal
  and testing codes (`XAU`, `XTS`, `XXX`, …) are rejected.
- Currency exponents are **not** modeled here. Adapters may add
  exponent helpers later.
- Canonical JSON: `{ "amount": "<base-10 integer>", "currency": "USD" }`.
  `JSON.stringify` on `bigint` is not supported.

Zero is a valid `Money`. Negative amounts are not. A **payment**
requires `requestedAmount > 0`. Zero-amount payment-method setup is a
future setup/session concept, not a fake payment.

## Identifiers

`PaymentId`, `RefundId`, `OrganizationId`, and `CustomerId` are branded
UUID strings. The domain does not generate UUIDs.

## Payment states

| State                     | Meaning                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `CREATED`                 | Internal payment exists; processing has not begun.                                   |
| `REQUIRES_PAYMENT_METHOD` | No usable tokenized payment method is attached.                                      |
| `REQUIRES_ACTION`         | Customer action is required (3DS, redirect, SDK). Not a Stripe `next_action`.        |
| `AUTHORIZING`             | Authorization is in progress; no final result yet.                                   |
| `AUTHORIZED`              | Funds reserved, not captured (manual capture).                                       |
| `CAPTURING`               | Capture is in progress.                                                              |
| `SUCCEEDED`               | Requested payable amount was captured at execution-state level. Not bank settlement. |
| `FAILED`                  | Processing failed; a new payment is required.                                        |
| `CANCELED`                | Authorization voided before capture.                                                 |
| `PARTIALLY_REFUNDED`      | `0 < refunded < captured` after success.                                             |
| `REFUNDED`                | `refunded == captured` after success.                                                |

`FAILED`, `CANCELED`, and `REFUNDED` close the payment lifecycle.
`SUCCEEDED` is terminal for authorize/capture but can move to refund
states. Helpers: `isPaymentExecutionTerminal`,
`isRefundablePaymentState`, `isPaymentLifecycleClosed`.

## Transition matrix

Exactly the table in
[`payment-lifecycle.md`](./payment-lifecycle.md#allowed-transitions).

```text
CREATED → REQUIRES_PAYMENT_METHOD | AUTHORIZING
REQUIRES_PAYMENT_METHOD → AUTHORIZING
AUTHORIZING → REQUIRES_ACTION | AUTHORIZED | CAPTURING | FAILED
REQUIRES_ACTION → AUTHORIZING | FAILED
AUTHORIZED → CAPTURING | CANCELED | FAILED
CAPTURING → SUCCEEDED | FAILED
SUCCEEDED → PARTIALLY_REFUNDED | REFUNDED
PARTIALLY_REFUNDED → PARTIALLY_REFUNDED | REFUNDED
FAILED | CANCELED | REFUNDED → ∅
```

`AUTHORIZING → AUTHORIZED` is the manual-capture path.
`AUTHORIZING → CAPTURING` is the automatic-capture path.

Use `canTransitionPayment` / `assertPaymentTransition`. Illegal
assignment throws `INVALID_PAYMENT_TRANSITION`.

## Capture

`AUTOMATIC` — successful authorization proceeds to `CAPTURING`.
`MANUAL` — authorization may sit in `AUTHORIZED` until capture.

The domain allows a **partial captured amount**:
`0 < capture <= remaining authorized`. That is monetary possibility,
not a provider capability. The state machine defines **one** capture
completion (`CAPTURING → SUCCEEDED`). Repeated incremental captures
are not in the matrix; adapters will declare whether a provider
supports them later.

Overcapture and incremental authorization are deferred.
`authorizedAmount <= requestedAmount`.
`capturedAmount <= authorizedAmount`.

## Refunds

Refund states: `CREATED`, `PROCESSING`, `SUCCEEDED`, `FAILED`.
There is no refund `CANCELED` — once submitted, a refund succeeds or
fails.

Reasons: `CUSTOMER_REQUEST`, `DUPLICATE`, `FRAUDULENT`,
`PRODUCT_OR_SERVICE`, `OTHER`.

`derivePaymentRefundState` maps captured/refunded totals onto
`SUCCEEDED` / `PARTIALLY_REFUNDED` / `REFUNDED` and refuses to
override `FAILED` / `CANCELED` / pre-success states.

`assertRefundFitsCaptured` checks
`alreadyRefunded + reserved + incoming <= captured`. This is a pure
policy helper. It does **not** prevent two concurrent database writes
from over-refunding. Persistence must enforce that later.

## Monetary invariants

For any valid payment:

```text
0 <= refundedAmount <= capturedAmount <= authorizedAmount <= requestedAmount
```

All four amounts share one currency. `requestedAmount > 0`.

## Failure model

`PaymentFailure` is `{ category, message, retryable, code? }`.
Categories: `DECLINED`, `AUTHENTICATION`, `INSUFFICIENT_FUNDS`,
`INVALID_PAYMENT_METHOD`, `PROCESSING`, `PROVIDER`, `UNKNOWN`.
No raw provider exception, stack, or payload.

## Payment methods

`PaymentMethodReference` is `{ id, type }` with `CARD` |
`BANK_ACCOUNT` | `WALLET` | `OTHER`. No PAN, CVC, or track data.
Customer-action details (`REDIRECT` / `SDK` /
`DISPLAY_INSTRUCTIONS`) are boundary types, not aggregate fields.

## Domain vs capability vs concurrency

| Layer                   | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| Domain possibility      | The numbers and states are legal (e.g. remaining capturable > 0).     |
| Provider capability     | Whether that provider can execute the command (`provider-contracts`). |
| Persistence concurrency | Whether two writers can race (later transactions).                    |

## Deferred

Incremental authorization, overcapture, disputes/chargebacks,
asynchronous bank settlement, multi-capture provider support, setup
intents / payment-method setup, installments, FX, split payments, and
marketplace fund flows are not represented as implemented features.
