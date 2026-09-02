# Stripe provider adapter

Authoritative description of `@fraterunion-payments/provider-stripe`.
This adapter proves **Stripe adapts to FraterUnion Payments**, not the
reverse.

Last updated: 2026-09-02

## Role

```text
FraterUnion application
      |
      | PaymentProvider
      v
provider-stripe
      |
      | Stripe SDK
      v
Stripe API
```

Stripe types, objects, and SDK errors stop inside `provider-stripe`.
Callers receive canonical `payment-core` / `provider-contracts` types
only.

This package does **not**:

- persist Payments, Refunds, or provider IDs
- expose HTTP routes (`/stripe/*` or otherwise)
- orchestrate public Payment/Refund APIs
- onboard Stripe Connect accounts
- ingest or verify webhooks
- collect raw cards or PaymentMethods
- invent idempotency keys

Public APIs continue to behave as before. Application wiring is a later
commit.

## Dependency direction

```text
payment-core
     ↑
provider-contracts
     ↑
provider-stripe
     ↑
stripe (SDK)
```

`payment-core` and `provider-contracts` must never import `stripe`.
The Stripe Node SDK lives only in this package.

## Configuration

The adapter does not read `process.env`. The application supplies:

```ts
new StripePaymentProvider({
  secretKey,
  apiVersion?, // must be the pinned version when provided
  appInfo?,
})
```

The secret key is not logged and is not exposed on the instance.

Optional test-mode integration uses `STRIPE_TEST_SECRET_KEY` in the test
runner only. That variable is not part of API environment validation.

## Pinned Stripe API version

| Item        | Value               |
| ----------- | ------------------- |
| Node SDK    | `stripe` 22.6.1     |
| API version | `2026-08-26.dahlia` |

The client is constructed with this `apiVersion` explicitly. Account
default API versions are not used. Stripe SDK network retries are
disabled (`maxNetworkRetries: 0`) so the SDK cannot invent idempotency
keys.

## Provider identity and capabilities

Provider code: `stripe`.

| Capability        | Declared  | Meaning in this adapter                                      |
| ----------------- | --------- | ------------------------------------------------------------ |
| `manualCapture`   | true      | `MANUAL` maps to Stripe `capture_method: manual`             |
| `partialCapture`  | true      | Capture may send `amount_to_capture` below capturable        |
| `multipleCapture` | **false** | Default Stripe final capture only; no `final_capture: false` |
| `fullRefund`      | true      | Refund of the observed captured amount                       |
| `partialRefund`   | true      | Refund less than the observed captured amount                |
| `customerVault`   | true      | `createCustomer` maps to Stripe Customers                    |

`multipleCapture` is false even though Stripe has a specialized
multicapture path. This adapter does not implement that path and must
not advertise it.

Async payment methods, PaymentMethod collection, SetupIntents, invoices,
subscriptions, and disputes are not implemented and are not advertised.

## Customer mapping

`createCustomer` maps optional `email`, `name`, and bounded
string→string metadata onto Stripe Customer creation.

Email and name are not required. A customer is **not** created inside
`createPayment`; customer provisioning is explicit.

Result: `ProviderCustomerReference` (`provider: stripe`, `id: cus_…`)
plus `observedAt`. Never a `Stripe.Customer`.

## Payment mapping

Stripe PaymentIntents are an internal implementation detail.

Canonical `createPayment` input stays FUP-shaped: organization, payment
id, `Money`, `CaptureMethod`, optional customer/payment-method
references, idempotency key, metadata, optional provider account.

| FUP `CaptureMethod` | Stripe `capture_method` |
| ------------------- | ----------------------- |
| `AUTOMATIC`         | `automatic`             |
| `MANUAL`            | `manual`                |

`automatic_async` is not used. `capture_method` is not part of the
public adapter result.

If a `ProviderPaymentMethodReference` is present, the adapter confirms
the PaymentIntent with that `pm_…` id. If absent, it creates an
unconfirmed PaymentIntent and observes `REQUIRES_PAYMENT_METHOD`. It
never invents a fake `OTHER` method.

### PaymentIntent status → FUP state

Stripe statuses for API `2026-08-26.dahlia`:
`requires_payment_method`, `requires_confirmation`, `requires_action`,
`processing`, `requires_capture`, `succeeded`, `canceled`.

There is no Stripe equivalent of internal `CREATED`. Adapter
observations begin after a provider resource exists.

| Stripe status             | FUP state                    | Notes                                                                                |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `requires_payment_method` | `REQUIRES_PAYMENT_METHOD`    | `last_payment_error` may add `PaymentFailure`                                        |
| `requires_confirmation`   | `REQUIRES_ACTION`            | Confirmation is still required                                                       |
| `requires_action`         | `REQUIRES_ACTION`            | See action mapping                                                                   |
| `processing`              | `AUTHORIZING` or `CAPTURING` | Manual create/retrieve → `AUTHORIZING`; automatic or capture operation → `CAPTURING` |
| `requires_capture`        | `AUTHORIZED`                 | Manual capture hold                                                                  |
| `succeeded`               | `SUCCEEDED`                  | Captured                                                                             |
| `canceled`                | `CANCELED`                   |                                                                                      |

Unknown Stripe statuses throw `ProviderContractError`. They are not
added to `payment-core`.

`processing` is asynchronous and ambiguous relative to FUP's
authorize-vs-capture split. The mapping uses capture method plus current
operation. It is an observation, not settlement finality. Webhooks and
later retrieve/reconciliation remain authoritative.

### Action requirement

Stripe `next_action.type` maps to `PaymentActionRequirement.type` only:

| Stripe `next_action.type` (examples)        | FUP type               |
| ------------------------------------------- | ---------------------- |
| `redirect_to_url`, `alipay_handle_redirect` | `REDIRECT`             |
| `use_stripe_sdk`                            | `SDK`                  |
| display / QR / microdeposits types          | `DISPLAY_INSTRUCTIONS` |
| unknown                                     | omitted                |

Raw `next_action` objects, redirect URLs, and Stripe.js payloads are
not copied. Current `PaymentActionRequirement` has no execution-artifact
slot.

**`client_secret` is not returned.** It is an execution credential, not
payment metadata. Client-side confirmation needs an explicit safe
artifact contract in a later commit.

### Amount formulas

Stripe PaymentIntent fields used:

```text
requestedAmount   = amount
capturedAmount    = amount_received when > 0, else omitted
authorizedAmount  = amount_capturable + amount_received when > 0, else omitted
```

- Automatic `succeeded`: received = requested, capturable = 0 → both
  authorized and captured equal requested.
- Manual `requires_capture`: capturable = requested, received = 0 →
  authorized only. `amount_received` is not treated as authorized.
- Default **final** partial capture: remaining hold is released, so
  authorized collapses to the captured amount in the observation.
- `refundedAmount` is omitted on retrieve (no Charge expand). Missing
  means “not observed,” not zero.

## Capture and cancellation

`capturePayment` retrieves the PaymentIntent, rejects remaining
multicapture (`amount_received > 0` and `amount_capturable > 0`), then
captures with `amount_to_capture`. It never sets `final_capture: false`.

`cancelPayment` cancels the PaymentIntent. If Stripe allows cancel in
more states than FUP does, the application/domain layer still decides
whether calling cancel is legal. The adapter does not redefine the
canonical lifecycle.

## Refund mapping

Stripe Refunds are internal. Input is a provider **payment** reference,
FUP refund id, amount, optional reason, idempotency, account context.
A provider refund reference is returned; it is not required as input.

### Reason

Stripe create reasons: `duplicate`, `fraudulent`,
`requested_by_customer`.

| FUP reason           | Stripe reason |
| -------------------- | ------------- |
| `DUPLICATE`          | `duplicate`   |
| `FRAUDULENT`         | `fraudulent`  |
| `CUSTOMER_REQUEST`   | omitted       |
| `PRODUCT_OR_SERVICE` | omitted       |
| `OTHER`              | omitted       |
| omitted              | omitted       |

`CUSTOMER_REQUEST` is not sent as `requested_by_customer` because that
Stripe value has fraud-list side effects this adapter will not imply.

### Status

| Stripe refund status | FUP refund state |
| -------------------- | ---------------- |
| `pending`            | `PROCESSING`     |
| `requires_action`    | `PROCESSING`     |
| `succeeded`          | `SUCCEEDED`      |
| `failed`             | `FAILED`         |
| `canceled`           | `FAILED`         |

FUP has no canceled refund state. Adapter refunds never emit `CREATED`
(`CREATED` is internal pre-provider).

## Money conversion

Canonical `Money.amount` is `bigint`. Stripe amounts are JavaScript
numbers.

```text
request:  bigint → number only if 1 ≤ amount ≤ Number.MAX_SAFE_INTEGER
response: number → bigint only if integer, ≥ 0, and Number.isSafeInteger
currency: FUP uppercase ISO 4217 → Stripe lowercase
```

The adapter never does an unchecked `Number(bigint)`. Overflow throws
`ProviderContractError` before the Stripe call. Stripe per-currency
minimums may still fail at the API; those are provider errors, not
silent truncation.

`observedAt` is the adapter clock (`new Date()` or an injected clock)
around the observation. It is **not** Stripe's `created` timestamp.

## Idempotency

Every mutating call forwards the application `ProviderIdempotencyKey` as
Stripe `idempotencyKey`. The adapter does not derive, hash, timestamp,
or replace keys.

## Connected-account execution context

If `ProviderAccountReference` is supplied and owned by `stripe`, the
adapter sets Stripe request option `stripeAccount` to that opaque id.
That field is not part of provider-contract types and is not persisted
here. Connect onboarding is not implemented.

## Error normalization

| Kind                                            | Mapping                                                      |
| ----------------------------------------------- | ------------------------------------------------------------ |
| Card / decline (`card_error`, structured codes) | `PaymentFailure` on the observation                          |
| Authentication / permission                     | `ProviderAuthenticationError`                                |
| Rate limit                                      | `ProviderRateLimitError` (`retryAfterMs` from `Retry-After`) |
| Timeout                                         | `ProviderTimeoutError`                                       |
| Connection / 5xx                                | `ProviderUnavailableError`                                   |
| Invalid request                                 | `ProviderConfigurationError`                                 |

A declined card is never an infrastructure outage. An invalid Stripe
secret is never a customer `PaymentFailure`.

Public errors do not include secret keys, Authorization headers, request
bodies, raw Stripe objects, payment-method details, or stacks. Stripe
request IDs are not added to domain models.

## Card-data boundary

No adapter method accepts PAN, CVC, expiry, or track data. Payment
methods must already be `ProviderPaymentMethodReference` values with
`provider = stripe` and a provider token such as `pm_…`.

Test fixtures may use Stripe test tokens (`pm_card_visa`). They must
not send raw `4242…` card numbers.

## Observations are not database truth

Every result is a **provider observation at `observedAt`**. Future
orchestration will:

```text
call adapter → receive observation → apply domain transition → persist
```

This package performs none of those persistence steps.

## Integration tests

Deterministic unit tests and the provider-contract harness use a fake
Stripe client. They do not require credentials.

Opt-in Stripe test-mode tests run only when `STRIPE_TEST_SECRET_KEY`
starts with `sk_test_`. Live keys are never used. Missing credentials
skip cleanly; CI must not fail.

## Related documents

- [`provider-contracts.md`](./provider-contracts.md)
- [`payment-lifecycle.md`](./payment-lifecycle.md)
- [`refunds.md`](./refunds.md)
- [ADR-004](../decisions/ADR-004-provider-abstraction.md)
- [ADR-005](../decisions/ADR-005-no-raw-card-data.md)
