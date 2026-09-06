# @fraterunion-payments/payment-application

Application composition for payment financial processing.

This package is the only place that combines generic event-delivery
infrastructure, Stripe payload normalization, payment-core observations,
ledger posting, and persistence. It exists because both `apps/api`
(Nest inbox processor and tests) and `apps/worker` (InboxWorker Stripe
handler) must run the same apply path.

```text
             payment-core
                  ↑
                  |
events ← payment-application → provider-stripe
                  |
                  +---- ledger-application → ledger-core
                  ↓
               database
```

Generic events infrastructure never imports a payment provider.
`ledger-application` never imports this package.

## What this package owns

- `processStripeInboxEvent` — claimed Stripe Inbox → normalize →
  execution lookup → `applyPaymentProviderObservation` /
  `applyRefundProviderObservation` → audit → ensure ledger journals →
  Inbox `PROCESSED`
- `ensurePaymentCaptureLedgerPosting` /
  `ensureRefundLedgerPosting` — provider-neutral Payment/Refund journals

Successful captured Payments debit Provider Receivable and credit
Settlement Payable for `Payment.capturedAmount`. Succeeded Refunds
reverse that position for `Refund.amount`. Authorization and failed
states post nothing. Identity is `ledger:payment:capture:<paymentId>` /
`ledger:refund:<refundId>`, never a Stripe Event ID.

See
[`docs/architecture/payment-ledger-posting.md`](../../docs/architecture/payment-ledger-posting.md)
and
[`docs/architecture/stripe-webhook-normalization.md`](../../docs/architecture/stripe-webhook-normalization.md).

## What this package is not

- Not generic Inbox/Outbox infrastructure (`@fraterunion-payments/events`)
- Not Stripe parsing (`normalizeStripeFinancialEvent` stays in
  `provider-stripe`)
- Not provider-neutral lifecycle math (`applyPaymentProviderObservation`
  stays in `payment-core`)
- Not generic ledger persistence (`@fraterunion-payments/ledger-application`)
- Not an HTTP or worker process
- Not a Stripe PaymentIntent creator (`POST /payments` remains unwired)
