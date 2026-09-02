# Provider contracts

Authoritative description of the provider abstraction boundary in
`@fraterunion-payments/provider-contracts`. No adapter, HTTP route,
webhook verifier, or provider-account persistence lives here.

Last updated: 2026-09-02

## Dependency direction

```text
payment-core
        ↑
provider-contracts
        ↑
provider-stripe (future)
```

`payment-core` remains unaware of providers. Provider adapters depend on
these contracts and translate external objects into payment-core types.

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

Conceptual future mapping (docs only — not implemented):

```text
Stripe PaymentIntent
  → translated by provider-stripe
  → canonical PaymentState / Money / PaymentFailure
```

Source contracts are not Stripe-shaped.

## Domain ownership

The domain language belongs to FraterUnion Payments. Contracts reuse
`Money`, `PaymentState`, `RefundState`, `CaptureMethod`,
`PaymentFailure`, `PaymentActionRequirement`, and branded IDs from
`payment-core`. They do not fork those types.

`payment-core` already exposes loose domain-boundary identifiers
(`provider` + `providerPaymentId`). This package defines
**execution-boundary** references:

```text
{ provider: PaymentProviderCode, id }
```

`PaymentProviderCode` is validated (lowercase `[a-z0-9_-]`, bounded).
Resource IDs are opaque strings — not UUIDs. A payment-method reference
is provider-bound so a token from one provider cannot be routed to
another.

## Canonical operations

| Method            | Mutating | Requires idempotency key |
| ----------------- | -------- | ------------------------ |
| `createCustomer`  | yes      | yes                      |
| `createPayment`   | yes      | yes                      |
| `capturePayment`  | yes      | yes                      |
| `cancelPayment`   | yes      | yes                      |
| `refundPayment`   | yes      | yes                      |
| `retrievePayment` | no       | no                       |

There is no `retrieveRefund`, `verifyWebhook`, or `parseWebhook` in this
commit. Webhook raw-body semantics stay unlocked until the later webhook
commit.

## Capabilities

Adapters declare what they can execute:

```text
manualCapture
partialCapture
multipleCapture
fullRefund
partialRefund
customerVault
```

Application code must assert a capability **before** invoking an
unsupported command (`assertProviderSupportsPartialCapture`, …).
Advertised support does not guarantee the provider call will succeed.

**Domain possibility** (remaining capturable amount) is not the same as
**provider capability** (this adapter can issue that command).

Cancel-after-authorization is gated by `manualCapture`: `AUTHORIZED`
only exists on the manual-capture path.

Merchant-account currency support is **not** a static provider property.
Connected-account configuration will resolve that later. Do not hardcode
a global supported-currency list here.

## Idempotency

The application layer generates `ProviderIdempotencyKey`. Adapters map
it onto the provider’s idempotency mechanism. Adapters must not invent a
new key on retry.

## Provider and account identity

| Type                             | Meaning                                       |
| -------------------------------- | --------------------------------------------- |
| `PaymentProviderCode`            | Internal routing identity, not a display name |
| `ProviderAccountReference`       | Optional connected merchant/account           |
| `ProviderPaymentReference`       | Provider-owned payment execution id           |
| `ProviderCustomerReference`      | Provider-owned customer vault id              |
| `ProviderRefundReference`        | Provider-owned refund id                      |
| `ProviderPaymentMethodReference` | Provider-owned tokenized method               |

`ProviderAccountReference` is optional for providers that do not use
subaccounts. It is never named after a specific vendor.

No `apiKey` / `secretKey` fields exist on these types. Credentials enter
adapter constructors through secure infrastructure later.

## Normalized outcomes

Payment operations return a `ProviderPaymentObservation`:

```text
providerPaymentReference
state
authorizedAmount?
capturedAmount?
actionRequirement?
failure?
observedAt
```

`retrievePayment` may also include `requestedAmount` and `refundedAmount`
when the provider exposes them. Missing amount fields mean “not observed
on this endpoint,” not “zero.”

`observedAt` is when **our adapter** observed provider state. It is not
the provider’s settlement timestamp.

A provider operation response is an **observation**, not always the
final authoritative settlement state. Customer action
(`REQUIRES_ACTION`) and in-flight authorization (`AUTHORIZING`) are
valid intermediate observations. Webhooks and retrieve converge later.

## Failures

| Kind                                 | Example                     | Retry?                            |
| ------------------------------------ | --------------------------- | --------------------------------- |
| Normalized `PaymentFailure`          | card `DECLINED`             | business/retryable on the failure |
| `ProviderTimeoutError`               | no HTTP response            | yes                               |
| `ProviderUnavailableError`           | provider outage             | yes                               |
| `ProviderRateLimitError`             | throttled (`retryAfterMs`?) | yes                               |
| `ProviderAuthenticationError`        | bad credentials             | no, until config changes          |
| `ProviderConfigurationError`         | missing merchant account    | no, until config changes          |
| `UnsupportedProviderCapabilityError` | advertised capability false | no                                |

A declined card is not a provider outage. Adapters catch SDK exceptions
and throw or return these types. Raw `StripeError`-class objects are not
part of the public contract.

## Registry

```text
register providers → freeze → runtime lookup
```

`PaymentProviderRegistry` is constructed by the application. It is not a
global singleton. Duplicate codes fail. Unknown codes fail. Registration
after `freeze()` fails. Topology must not change during payment
processing.

## Card data

Inputs accept only tokenized/safe references. Never PAN, CVC, full card
number, or track data. Metadata is string-to-string, size-bounded, and
rejects secret-bearing keys. Adapters may tighten those limits further.

## Deferred

- Stripe / any real adapter
- Provider account persistence and secrets
- Webhook verification and parsing
- Merchant-account currency resolution
- `retrieveRefund`
- Client SDK execution artifacts (client tokens) as a formal type
- Incremental authorization, overcapture, disputes
