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
  StripeConnectProvider,
  type StripePaymentProviderConfig,
  type StripeConnectProviderConfig,
  STRIPE_API_VERSION,
  STRIPE_PROVIDER_CODE,
} from '@fraterunion-payments/provider-stripe';

const payments = new StripePaymentProvider({
  secretKey: suppliedByTheApplication,
});
const connect = new StripeConnectProvider({
  secretKey: suppliedByTheApplication,
  allowLive: false,
  urlEnvironment: 'test',
});
```

The raw Stripe client is not part of the public API. This package does
not read `process.env`.

Pinned versions: Stripe Node SDK **22.6.1**, API **2026-08-26.dahlia**.

Webhook verification:

```ts
import {
  verifyStripeWebhook,
  createStripeWebhookTestSignature,
} from '@fraterunion-payments/provider-stripe';

const verified = verifyStripeWebhook({
  rawBody, // exact Buffer or string from the HTTP request
  signature, // Stripe-Signature header
  secrets: [currentSecret, previousSecret],
});
```

`verified.payload` is plain JSON, never `Stripe.Event`. HTTP ingestion
and inbox persistence live in `apps/api`. See
[`docs/architecture/stripe-webhook-ingestion.md`](../../docs/architecture/stripe-webhook-ingestion.md).

## What this package is not

It does not write to the database, expose HTTP routes, handle raw cards,
or wire public Payment / Refund APIs. Connect onboarding is implemented
here as `StripeConnectProvider` (Accounts v2 + hosted Account Links).
See [`docs/architecture/stripe-connect.md`](../../docs/architecture/stripe-connect.md).

## Tests

```bash
pnpm --filter @fraterunion-payments/provider-stripe test
```

Unit tests use a fake Stripe client and do not need credentials.

Opt-in Stripe test-mode integration runs only when `STRIPE_TEST_SECRET_KEY`
is a `sk_test_…` key. Live keys are ignored. Missing keys skip cleanly.
Never commit a key. Do not send raw card numbers; use Stripe test
payment-method tokens such as `pm_card_visa`.
