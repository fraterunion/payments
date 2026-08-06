# ADR-008: Provider-owned merchant accounts

## Status

Accepted

The high-level operating model described below — tenants own their
merchant relationship, and FraterUnion Payments does not custody or
redistribute funds — is accepted. The specific technical mechanism for
onboarding a tenant's provider account (for example, which Stripe Connect
account type, if any, is used) is explicitly **not** decided by this ADR
and remains subject to implementation analysis; see
[Implementation implications](#implementation-implications) and
[`../product/v1-scope.md`](../product/v1-scope.md#stripe).

Last updated: 2026-08-06

## Context

Custody of customer or merchant funds, and controlling payouts, create
substantial legal, financial, and operational obligations (money
transmission licensing, payout risk, settlement liability) that are out of
scope for FraterUnion Payments' current stage (see
[`../product/vision.md`](../product/vision.md#non-goals)). A direct
merchant relationship between each tenant and the payment provider avoids
FraterUnion taking on these obligations, at the cost of a more involved
tenant onboarding process and less FraterUnion control over pricing and
settlement timing than a custodial model would allow.

## Decision

- In the initial operating model, each tenant owns or directly controls
  its own merchant account with the payment provider.
- Provider settlement goes directly to the tenant's own configured bank
  relationship — not to a FraterUnion-controlled account.
- FraterUnion Payments orchestrates payments (creation, capture, refunds,
  reconciliation) but does not initially custody or redistribute funds
  between tenants or to itself.
- The exact technical mechanism for provider-account onboarding (for
  Stripe specifically, whether and which Connect account type is used)
  remains subject to implementation analysis and is not fixed by this
  ADR.

## Consequences

### Positive

- Materially lower regulatory and financial risk for FraterUnion: it is
  not holding or moving tenant funds, and is not exposed to payout
  or settlement liability.
- Each tenant's relationship with its provider (pricing, support, dispute
  handling for their own account) stays direct and transparent to them.
- Avoids the substantial compliance burden of Merchant of Record or PayFac
  status (see [`../product/vision.md`](../product/vision.md#non-goals)) in
  the initial phase.

### Negative

- Tenant onboarding is more involved than "sign up and start charging,"
  since each tenant must establish its own provider merchant relationship.
- FraterUnion has less control over pricing, settlement timing, and the
  tenant's provider-side experience than a fully custodial model would
  allow.
- Provider-account capabilities (what a given tenant's account supports)
  can vary per tenant based on how their provider account is configured,
  which the platform must account for rather than assume uniformly.

### Risks and mitigations

- **Money is implicitly represented or discussed as FraterUnion's own,
  when it is contractually the tenant's.** Mitigated by an explicit rule
  (see [Implementation implications](#implementation-implications)) that
  internal representations must not imply FraterUnion ownership of funds
  unless that is contractually true.
- **A future feature quietly reintroduces custody-like behavior (for
  example, an internal payout queue) without a deliberate decision.**
  Mitigated by explicitly stating that no internal payout engine exists in
  v1, and that introducing one requires a new ADR (see
  [Revisit conditions](#revisit-conditions)).
- **Tenant onboarding friction discourages adoption.** Acknowledged as a
  real tradeoff of this model rather than mitigated away; it is accepted
  as the cost of avoiding custody-related obligations at this stage.

## Alternatives considered

- **One FraterUnion merchant account for all tenants.** Rejected — this
  would make FraterUnion the merchant of record in practice, taking on
  settlement and compliance obligations disproportionate to the platform's
  current stage.
- **FraterUnion-controlled payouts** (FraterUnion receives funds and pays
  tenants out on its own schedule). Rejected — this is a custodial model
  with money-transmission-adjacent implications that require legal and
  regulatory groundwork not yet in place.
- **Merchant of Record.** Rejected for now — a significant undertaking
  with tax, liability, and compliance implications beyond the current
  product scope (see
  [`../product/v1-scope.md`](../product/v1-scope.md#explicitly-out-of-scope-for-v1)).
- **Payment Facilitator (PayFac).** Rejected for v1 for the same reasons;
  remains a possible, deliberate future direction, not a default.
- **Marketplace-style split payments.** Rejected — not required by any
  current use case, and introduces payout-distribution complexity and risk
  the platform does not need to take on yet.

## Implementation implications

- Provider-account mappings (a tenant's connection to their provider
  merchant account) are organization-scoped, consistent with ADR-003.
- Money must never be represented internally as owned by FraterUnion
  unless that is contractually true; ledger and reporting language must
  reflect that funds belong to and settle to the tenant.
- Each tenant's provider onboarding status and account capabilities must
  be tracked, since they can vary per tenant and affect what operations
  (for example, manual capture) are available to them.
- No internal payout engine exists in v1 — FraterUnion Payments does not
  build logic to move settled funds on the tenant's behalf.
- Any commercial payment-margin or fee model FraterUnion introduces must
  be built on legitimate, disclosed provider partnership agreements (see
  [`../product/vision.md`](../product/vision.md#long-term-vision)), not on
  controlling or intercepting tenant settlement.

## Revisit conditions

- FraterUnion adopts a formal PayFac, Merchant of Record, or marketplace
  strategy, following legal and compliance approval.
- A provider partnership specifically supports a different onboarding or
  settlement model that changes this calculus.
- Custody or split payments become a committed product requirement,
  supported by the legal and compliance review this would require (see
  [`../product/vision.md`](../product/vision.md#non-goals)).
