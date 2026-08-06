# FraterUnion Payments — V1 Scope

## Status

Authoritative. Defines the committed boundary for the first implementation
milestone ("payment-core"). Anything not listed under **In scope** is
deferred or explicitly out of scope, regardless of how reasonable it may
seem to add opportunistically. See [`vision.md`](./vision.md) for the
long-term direction this milestone works toward.

Last updated: 2026-08-06

## V1 objective

V1 exists to prove one reliable, observable, reconciled payment flow
end-to-end, through a single provider, before any additional providers or
billing models are introduced:

```text
Consumer product
    → FraterUnion Payments API
    → Stripe adapter
    → Stripe
    → verified webhook
    → normalized payment state
    → ledger entries
    → consumer webhook
    → reconciliation
```

Every capability listed below exists to make this flow correct, observable,
and safe to operate — not to build a feature-complete payments platform in
one milestone.

## In scope

### Platform

- Multi-tenant organizations.
- Users and organization memberships.
- Role-based access control (RBAC).
- API keys with scopes.
- Audit logs for privileged and financial operations.
- Provider accounts (a tenant's connection to a specific provider).

### Customers

- Customer records, scoped to an organization.
- Addresses.
- Tax metadata placeholders (fields reserved for future tax logic, not a
  tax engine).
- Provider customer mappings (FraterUnion customer → provider customer
  identifier).
- Tokenized payment-method references (provider tokens/identifiers only —
  see [`../architecture/security-boundaries.md`](../architecture/security-boundaries.md)).

### Payments

- Payment creation.
- Automatic capture.
- Manual authorization and capture (two-step flow).
- Cancellation.
- Full refunds.
- Partial refunds.
- Payment attempts (an auditable record of each provider call for a
  payment, including failures).
- Idempotency for payment creation and mutation.
- Metadata and external references so consumer products can correlate
  FraterUnion payments with their own records.

### Stripe

- Stripe as the first, and for v1 the only, provider adapter.
- Stripe-hosted or Stripe SDK tokenization (Stripe Elements, Stripe.js, or
  Stripe-hosted pages) as the client-side collection method.
- Payment Intents for one-time payments.
- Setup Intents for saving a payment method without an immediate charge.
- Verified, durable webhook ingestion.
- An approach to connected-merchant-account onboarding sufficient to
  support the v1 flow. The specific Stripe Connect account model (if any)
  is deliberately not committed here; it requires implementation-time
  analysis of FraterUnion's merchant-of-record and payout requirements
  before selection (see
  [ADR-008](../decisions/ADR-008-provider-owned-merchant-accounts.md)).

### Infrastructure

- Durable incoming webhook storage (persist before processing).
- Inbox pattern for incoming provider events; outbox pattern for outgoing
  tenant webhooks.
- Worker-based asynchronous processing, separate from the request/response
  path of the API.
- Retry policies for transient failures.
- Dead-letter handling for events that exhaust retries.
- Structured logging.
- Metrics and tracing for payment and webhook processing.
- Tenant-aware auditing (every audit record carries an organization).

### Financial operations

- Append-only, double-entry ledger (see
  [`../architecture/ledger-principles.md`](../architecture/ledger-principles.md)).
- Representations for payments, fees, refunds, and settlements.
- Reconciliation against provider transaction data.
- Explicit handling and surfacing of reconciliation mismatches — not
  silent auto-correction.

### Integration

- Versioned REST API.
- TypeScript SDK (`@fraterunion-payments/sdk`).
- Signed outgoing webhooks to consumer products.
- GymOS as the sandbox/reference integration proving the end-to-end flow.

### Admin

- Operational payment views (list, filter, inspect).
- Customer and payment detail views.
- Webhook diagnostics (delivery status, retries, failures).
- Reconciliation visibility (mismatches and their resolution state).
- Provider connection status per tenant.

## Deferred after payment-core milestone

The following are real, planned parts of the product — not rejected — but
are explicitly sequenced after one-time payments are proven reliable:

- Products.
- Prices.
- Subscriptions.
- Invoices.
- Recurring billing scheduler.
- Dunning.
- Coupons.
- Promotion codes.

Design constraints for subscriptions and the ledger implications of
recurring billing are documented in advance in
[`../architecture/subscription-lifecycle.md`](../architecture/subscription-lifecycle.md)
so that v1 data models do not need to be redesigned when this work starts.

## Explicitly out of scope for v1

- Raw card storage, in any form.
- Direct card network integrations.
- Custody of customer or merchant funds.
- Merchant payouts controlled or timed by FraterUnion.
- Split payments.
- Marketplace-style payouts to multiple parties from one payment.
- A full tax engine.
- Native CFDI generation (see [`vision.md`](./vision.md) — this remains a
  third-party, authorized-provider integration if pursued).
- Cryptocurrency payments.
- Smart/cost-aware provider routing (requires multiple providers first).
- A machine-learning fraud engine (provider-native fraud tooling is relied
  upon in v1).
- Multi-region active-active infrastructure.
- Ten simultaneous providers, or any provider beyond Stripe.
- A consumer-facing wallet.
- Currency conversion.
- PayFac operations.

## Success criteria

V1 is considered successful when all of the following are demonstrated
with automated tests, not manual verification alone:

- A payment can be created with an idempotency key.
- Duplicate API calls with the same idempotency key do not duplicate
  charges.
- Duplicate webhook deliveries do not duplicate state transitions or
  ledger entries.
- Payment status transitions are driven by verified provider events, not
  solely by client-side callbacks.
- A partial refund can be issued and is correctly represented in both
  payment state and the ledger.
- Ledger transactions balance (sum of debits equals sum of credits) for
  every posted transaction.
- Provider data can be reconciled against internal records, and
  discrepancies are surfaced rather than hidden.
- Consumer products receive signed, normalized outgoing events.
- Tenant data isolation is verified: no request in one organization's
  context can read or mutate another organization's data.
- No raw card data (PAN or CVC) appears in logs, API payloads, or storage
  at any point.
- The critical path (payment creation → provider execution → webhook →
  normalized state → ledger → consumer webhook) is covered by automated
  integration tests.
