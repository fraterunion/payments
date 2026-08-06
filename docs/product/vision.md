# FraterUnion Payments — Vision

## Status

Authoritative. Defines product intent and principles for all future
implementation work. This document does not describe implemented behavior;
see [`v1-scope.md`](./v1-scope.md) for what is actually being built first.

Last updated: 2026-08-06

## Mission

FraterUnion Payments exists to give every FraterUnion product (GymOS,
RestaurantOS, PlazaOS, WristOS, UMA Temple of Beauty, SugarOS, and future
products) one stable, provider-agnostic payment interface, while regulated
card processing, tokenization, and settlement remain the responsibility of
external, licensed payment providers. FraterUnion Payments orchestrates
payments, subscriptions, and the internal financial record; it does not
process cards itself.

## Strategic problem

Without a shared payments platform, each FraterUnion product tends to
integrate directly with a payment provider's SDK and API. This creates
problems that compound as the number of products grows:

- **Direct Stripe coupling across multiple products.** Each product embeds
  provider-specific logic, making the provider a hard dependency of the
  product rather than a swappable implementation detail.
- **Duplicate payment logic.** Idempotency handling, retry logic, webhook
  verification, and state normalization get reimplemented — inconsistently
  — in every product that takes payments.
- **Provider lock-in.** Switching or adding a provider (for cost, country
  coverage, or reliability reasons) requires touching every product
  individually instead of one platform.
- **Inconsistent webhooks and states.** Each product interprets provider
  webhook payloads and status values differently, producing divergent
  definitions of "paid," "failed," or "refunded."
- **Lack of unified ledger and reconciliation.** Without a shared financial
  record, there is no single place to verify that what providers report
  matches what FraterUnion products believe happened.
- **Difficulty changing providers by country or cost.** Provider suitability
  varies by geography and transaction economics; without an abstraction
  layer, that decision is baked into each product's codebase.
- **Inconsistent subscription implementations.** Recurring billing logic
  (trials, renewals, dunning, cancellation) is easy to get subtly wrong, and
  costly to get wrong differently in five products at once.
- **Limited cross-product financial visibility.** Leadership and finance
  have no consolidated view of payment volume, fees, or refunds across the
  FraterUnion portfolio.

FraterUnion Payments addresses these by centralizing payment orchestration,
provider abstraction, and the financial system of record behind one
internal API.

## Product principles

These principles are binding constraints on design and implementation, not
aspirations. Any change that violates one of them requires an explicit,
documented decision (see [`../decisions/`](../decisions/) once architecture
decision records exist).

1. **Provider independence.** No internal domain concept (payment,
   customer, subscription) may be modeled in terms of a specific provider's
   API shape. Providers are implementations of internal contracts, not the
   source of the contracts themselves.
2. **No raw card data.** FraterUnion Payments never receives, transmits,
   logs, or stores primary account numbers (PAN) or card verification codes
   (CVC). See [`../architecture/security-boundaries.md`](../architecture/security-boundaries.md).
3. **Financial correctness over feature speed.** When correctness and
   delivery speed conflict on anything that affects money, correctness
   wins. A missing feature is recoverable; an incorrect ledger is not.
4. **Idempotency everywhere money can move.** Every operation that creates,
   captures, refunds, or reverses money must be safe to retry. Network
   failures and duplicate requests must never duplicate financial effect.
5. **Webhooks are asynchronous facts, not optional notifications.**
   Provider webhooks are treated as durable, ordered-as-best-effort facts
   that must be persisted and processed reliably — not best-effort
   callbacks that can be silently dropped.
6. **Internal normalized states.** FraterUnion Payments defines its own
   provider-neutral state machines (see
   [`../architecture/payment-lifecycle.md`](../architecture/payment-lifecycle.md)
   and
   [`../architecture/subscription-lifecycle.md`](../architecture/subscription-lifecycle.md)).
   Provider-specific statuses are translated into these states at the
   adapter boundary and never leak past it.
7. **Append-only financial history.** Financial records are never mutated
   or deleted after posting. Corrections happen through compensating
   entries, not edits. See
   [`../architecture/ledger-principles.md`](../architecture/ledger-principles.md).
8. **Multi-tenant isolation.** Every tenant-owned record is explicitly
   scoped to an organization. No code path may resolve or mutate another
   tenant's data, whether by accident or by malicious input.
9. **Observability as a product requirement.** Structured logging, metrics,
   and tracing for payment and ledger operations are not optional
   afterthoughts; they are required to operate a financial system safely.
10. **Progressive complexity.** Capabilities are added in the order that
    lets each layer be validated before the next is built on top of it
    (see [`v1-scope.md`](./v1-scope.md)). The platform does not attempt to
    support every provider, region, or billing model simultaneously.
11. **Regulatory boundaries remain explicit.** FraterUnion Payments
    documents what it is and is not (see Non-goals below) so that scope
    does not silently drift into activities that require licenses,
    registrations, or certifications FraterUnion does not hold.
12. **One API for all FraterUnion products.** Every consumer product
    integrates against the same versioned FraterUnion Payments API and SDK,
    regardless of which provider ultimately executes a given transaction.

## Long-term vision

The following describes the direction FraterUnion Payments is intended to
grow toward. None of this is committed or implemented; it exists to give
early architectural decisions a consistent target. Committed scope for the
first implementation milestone is defined exclusively in
[`v1-scope.md`](./v1-scope.md).

- **Multiple providers** beyond Stripe (candidates include Helcim,
  Moneris, OpenPay, Conekta, Adyen, Mercado Pago, and Nuvei), selected
  based on actual market and volume needs rather than speculative coverage.
- **Country-aware routing** of payments to the provider best suited to a
  given customer's or merchant's country.
- **Cost-aware routing** that accounts for provider fees and FX costs when
  more than one provider can serve a transaction.
- **Provider failover** where technically and legally possible, to reduce
  the impact of a single provider outage.
- **Cross-provider analytics** giving a consolidated view of payment
  volume, fees, and refunds regardless of which provider executed the
  transaction.
- **Unified subscriptions** with consistent trial, renewal, dunning, and
  cancellation behavior regardless of the underlying provider.
- **Reconciliation** as an ongoing, automated comparison between provider
  records and FraterUnion Payments' own ledger.
- **CFDI integrations through authorized third parties** to support Mexican
  fiscal invoicing requirements, via certified providers rather than
  FraterUnion building fiscal-authority integrations directly.
- **Optional commercial monetization** through legitimate, disclosed
  provider partnership arrangements (for example, referral or volume
  agreements), never through markups that misrepresent provider pricing to
  tenants.
- **Standalone external product potential** — if the platform proves
  durable and valuable internally, offering it to non-FraterUnion products
  is a possible long-term direction, not a current goal.

## Non-goals

FraterUnion Payments is not currently intended to:

- Process cards directly (perform card network authorization itself).
- Store PAN or CVC, in any form, at any layer.
- Hold customer funds.
- Operate as a bank or otherwise provide banking services.
- Become a card network.
- Build custom acquiring infrastructure.
- Replace provider antifraud systems with FraterUnion-built fraud
  detection.
- Become a Merchant of Record on behalf of FraterUnion products.
- Become a Payment Facilitator (PayFac) in v1.
- Implement every candidate provider simultaneously.

These constraints exist because the activities above typically require
licenses, registrations, or certifications (money transmission, acquiring,
PCI Level 1 service provider status, PayFac sponsorship, and similar) that
are out of scope for the current stage of the platform. Revisiting any of
them requires an explicit product and legal decision, not an incremental
engineering choice.
