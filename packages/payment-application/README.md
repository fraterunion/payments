# @fraterunion-payments/payment-application

Application composition for payment financial processing.

This package is the only place that combines generic event-delivery
infrastructure, Stripe payload normalization, payment-core observations,
and persistence. It exists because both `apps/api` (Nest inbox processor
and tests) and `apps/worker` (InboxWorker Stripe handler) must run the
same apply path.

```text
             payment-core
                  ↑
                  |
events ← payment-application → provider-stripe
                  |
                  ↓
               database
```

Generic events infrastructure never imports a payment provider.

## What this package owns

- `processStripeInboxEvent` — claimed Stripe Inbox → normalize →
  execution lookup → `applyPaymentProviderObservation` /
  `applyRefundProviderObservation` → audit → Inbox `PROCESSED`

## What this package is not

- Not generic Inbox/Outbox infrastructure (`@fraterunion-payments/events`)
- Not Stripe parsing (`normalizeStripeFinancialEvent` stays in
  `provider-stripe`)
- Not provider-neutral lifecycle math (`applyPaymentProviderObservation`
  stays in `payment-core`)
- Not an HTTP or worker process

See
[`docs/architecture/stripe-webhook-normalization.md`](../../docs/architecture/stripe-webhook-normalization.md).
