# Provider payment executions

Authoritative description of `PaymentProviderExecution` and
`RefundProviderExecution`. These tables are the only place canonical
FraterUnion Payments aggregates bind to opaque provider objects.

Last updated: 2026-09-02

## Why executions exist

Canonical `payments` and `refunds` stay provider-neutral. They do **not**
store `stripePaymentIntentId`, `stripeRefundId`, `providerPaymentId`, or
`providerRefundId`.

A Payment may have more than one external execution over its life
(retries, routing, failover, later multi-provider orchestration). An
execution is a historical financial artifact, not a 1:1 pointer that
must last forever.

```text
Canonical Payment
      |
      +---- PaymentProviderExecution
                 |
                 +---- provider = stripe
                 +---- provider account context
                 +---- providerPaymentId = pi_...
                           |
                           +---- RefundProviderExecution
                                      +---- providerRefundId = re_...
```

Provider IDs stop at the execution layer. Webhook processors resolve
`pi_…` / `re_…` **only** through these rows. PaymentIntent metadata,
description, and customer fields are never tenant or payment authority.

## PaymentProviderExecution

| Field                      | Rule                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `id`                       | UUIDv7                                                                  |
| `organizationId`           | Explicit tenant. Organization FK `RESTRICT`.                            |
| `paymentId`                | Composite tenant FK to `payments(id, organizationId)` `RESTRICT`.       |
| `provider`                 | Extensible `VARCHAR`, `PaymentProviderCode` shape                       |
| `providerAccountReference` | Opaque connected-account id, or null on the platform                    |
| `providerAccountScope`     | `default` or `acct:<id>` — same convention as `CustomerProviderMapping` |
| `providerPaymentId`        | Opaque non-empty provider payment object id                             |

Uniqueness:

```text
(provider, providerAccountScope, providerPaymentId)
```

That triple globally identifies one provider payment object. The same
provider object cannot bind two canonical Payments. `(paymentId, provider)`
is **not** unique: multiple executions per payment remain possible.

Account context is part of identity. A platform object (`default`) and a
connected-account object (`acct:acct_…`) with the same opaque id are
different executions.

## RefundProviderExecution

| Field                        | Rule                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| `id`                         | UUIDv7                                                              |
| `organizationId`             | Explicit tenant. Organization FK `RESTRICT`.                        |
| `refundId` + `paymentId`     | Composite FK to `refunds(id, organizationId, paymentId)` `RESTRICT` |
| `paymentProviderExecutionId` | Composite FK to the parent payment execution including `paymentId`  |
| `provider` / account fields  | Copied from the parent payment execution                            |
| `providerRefundId`           | Opaque non-empty provider refund object id                          |

Uniqueness:

```text
(provider, providerAccountScope, providerRefundId)
```

The composite payment-execution FK makes it impossible for a refund on
Payment A to attach to Payment B's provider object at the database.

## Creation

There is **no** public HTTP API to attach provider ids.

`PaymentProviderExecutionService.create` and
`RefundProviderExecutionService.create` are internal orchestration
services. They:

- require organization + aggregate
- validate provider / account scope
- reject cross-tenant binds
- reject duplicate provider-object binds
- write audit `payment.provider_execution_created` /
  `refund.provider_execution_created`

Public `POST /payments` still does not create Stripe PaymentIntents or
executions.

## Audit

Execution binding is a durable financial association, so create is
audited. Metadata is safe (ids, provider code, booleans). It does not
include provider payloads or secrets.

## Deletion

No delete API. Organization, Payment, and Refund FKs are `RESTRICT`.
Financial history is not cascaded away.
