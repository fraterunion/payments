# @fraterunion-payments/provider-contracts

Provider abstraction boundary for FraterUnion Payments.

FraterUnion Payments owns the domain. Providers adapt to it.

```text
application
    ↓ canonical operation
provider-contracts
    ↓
provider adapter
    ↓
external provider

external result
    ↑ translation
provider adapter
    ↑ canonical normalized result
application / payment-core
```

This package is pure TypeScript. It does not depend on NestJS, Prisma,
HTTP, a provider SDK, logging, or `process.env`. It may depend on
`@fraterunion-payments/payment-core`. `payment-core` must not depend on
this package.

Authoritative notes:
[`docs/architecture/provider-contracts.md`](../../docs/architecture/provider-contracts.md).

## What this package is

- A `PaymentProvider` interface for create/capture/cancel/refund/retrieve
- Validated provider codes and opaque resource references
- Capability flags and assertion helpers
- Required application-generated idempotency keys on mutating calls
- Normalized observations and infrastructure error types
- An explicit, freezable `PaymentProviderRegistry`

## What this package is not

It does not persist provider accounts, verify webhooks, store secrets,
or expose raw SDK objects. Stripe adaptation lives in
`@fraterunion-payments/provider-stripe`.

A provider operation response is an **observation**, not always final
settlement state. Webhooks and `retrievePayment` later converge it.

Future adapters can run
`runPaymentProviderContractTests({ createProvider })` from
`@fraterunion-payments/provider-contracts/testing`.
