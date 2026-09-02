# @fraterunion-payments/provider-stripe

Stripe adapter for FraterUnion Payments.

Stripe adapts to FraterUnion Payments. FraterUnion Payments does not
become Stripe-shaped.

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

Stripe types stop inside this package.

Authoritative notes:
[`docs/architecture/stripe-provider-adapter.md`](../../docs/architecture/stripe-provider-adapter.md).

## Public API

```ts
import {
  StripePaymentProvider,
  type StripePaymentProviderConfig,
  STRIPE_API_VERSION,
  STRIPE_PROVIDER_CODE,
} from '@fraterunion-payments/provider-stripe';

const provider = new StripePaymentProvider({
  secretKey: suppliedByTheApplication,
});
```

The raw Stripe client is not part of the public API. This package does
not read `process.env`.

Pinned versions: Stripe Node SDK **22.6.1**, API **2026-08-26.dahlia**.

## What this package is not

It does not write to the database, expose HTTP routes, onboard Connect
accounts, verify webhooks, handle raw cards, or wire public Payment /
Refund APIs.

## Tests

```bash
pnpm --filter @fraterunion-payments/provider-stripe test
```

Unit tests use a fake Stripe client and do not need credentials.

Opt-in Stripe test-mode integration runs only when `STRIPE_TEST_SECRET_KEY`
is a `sk_test_…` key. Live keys are ignored. Missing keys skip cleanly.
Never commit a key. Do not send raw card numbers; use Stripe test
payment-method tokens such as `pm_card_visa`.
