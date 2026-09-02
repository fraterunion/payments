# @fraterunion-payments/payment-core

Provider-neutral payment domain for FraterUnion Payments.

This package is pure TypeScript. It does not depend on NestJS, Prisma,
HTTP, Stripe, a logging framework, or process environment. Providers
adapt to these types; the types do not adapt to Stripe.

Authoritative design notes live in
[`docs/architecture/payment-domain.md`](../../docs/architecture/payment-domain.md).
The state machine matches
[`docs/architecture/payment-lifecycle.md`](../../docs/architecture/payment-lifecycle.md).

## Convention

Invariant violations and illegal operations **throw** a
`PaymentDomainError` (or a subclass) with a machine-readable `code`.
Policy questions (`canCapture`, `canTransitionPayment`, …) return
booleans. Do not treat a `false` policy result as an exception, and do
not swallow thrown domain errors as “not allowed.”

## Money

Amounts are **`bigint` minor units** plus an uppercase ISO 4217 code
(ADR-009, ADR-010). Zero is allowed on `Money`. Payment
`requestedAmount` and refund amounts must be `> 0`.

Never `JSON.stringify` a `Money` value — `bigint` is not JSON. Use
`moneyToJSON` / `moneyFromJSON`:

```json
{ "amount": "12500", "currency": "USD" }
```

## What this package is not

It does not persist payments, call providers, emit outbox events, or
expose HTTP. Concurrent over-refund protection is a future
database/application concern; `assertRefundFitsCaptured` is only a
pure calculation.
