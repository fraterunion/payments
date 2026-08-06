# ADR-005: No raw card data

## Status

Accepted

Last updated: 2026-08-06

## Context

Handling raw card data (the primary account number, "PAN," and card
verification code, "CVC") significantly increases both security risk and
regulatory/compliance scope for any system that touches it. FraterUnion
Payments does not need raw card data to provide payment orchestration,
provider abstraction, or the internal ledger — every capability in
[`../product/v1-scope.md`](../product/v1-scope.md) can be built on top of
provider-issued tokens and payment-method references. This decision
formalizes that as a permanent architectural boundary rather than an
incidental consequence of the initial implementation.

## Decision

- FraterUnion Payments — the API, worker, Admin app, and all supporting
  infrastructure — never receives, transmits, logs, or stores raw PAN or
  CVC, under any circumstance.
- Sensitive card-data collection occurs exclusively in provider-controlled
  surfaces: provider SDKs (for example, Stripe.js/Elements), hosted
  fields, or hosted checkout pages.
- Internal systems receive only provider tokens, payment-method
  identifiers, or equivalent references — never the underlying card data
  those references represent.
- No feature, optimization, or integration may weaken this boundary
  without a new, explicit security and compliance decision superseding
  this ADR.

## Consequences

### Positive

- Materially smaller attack surface: there is no raw card data anywhere
  in FraterUnion Payments' systems to be stolen, logged accidentally, or
  mishandled.
- Reduced compliance scope, since the platform's own systems are not
  handling cardholder data directly (see the PCI scope strategy in
  [`../architecture/security-boundaries.md`](../architecture/security-boundaries.md#pci-scope-strategy)).
- Consumer products and end customers benefit from provider-grade card
  handling (fraud tooling, 3D Secure, PCI-compliant collection) without
  FraterUnion having to replicate it.

### Negative

- FraterUnion Payments depends entirely on provider-controlled collection
  flows; it cannot build a fully custom, provider-agnostic card-entry
  experience.
- Some custom payment experiences (for example, a single unified card
  form across providers with no provider-branded UI at all) are
  constrained by this boundary and by what each provider's SDK/hosted
  surface allows.
- Every new integration point (logging, error reporting, request/response
  capture, support tooling) has to be actively checked to ensure it cannot
  become a path for sensitive data to leak into FraterUnion systems.

### Risks and mitigations

- **A request DTO accidentally accepts a PAN/CVC field.** Mitigated by
  requiring request DTOs to structurally exclude these fields and by
  requiring tests that verify such fields are rejected (see
  [Implementation implications](#implementation-implications)).
- **Sensitive data leaks into logs or error reports.** Mitigated by
  redaction requirements on all logging and error-reporting paths (see
  [`../architecture/security-boundaries.md`](../architecture/security-boundaries.md#card-data-boundary)).
  This is treated as a critical defect if it occurs, not a minor bug.
- **A future integration (for example, a support tool or analytics
  pipeline) is added without this boundary in mind.** Mitigated by making
  this boundary an explicit, permanent architectural decision that new
  work is expected to be checked against, rather than an assumption that
  has to be independently rediscovered each time.

## Alternatives considered

- **Self-hosted card forms.** Rejected — this would put raw card data
  directly in a FraterUnion-controlled browser context and, typically, in
  transit to FraterUnion's own servers, exactly what this ADR exists to
  prevent.
- **A direct card vault operated by FraterUnion.** Rejected — this would
  make FraterUnion Payments a card-data custodian, dramatically expanding
  compliance scope and risk for no capability the platform actually
  requires (see [`../product/vision.md`](../product/vision.md#non-goals)).
- **Proxying card data through the FraterUnion Payments API** (even
  transiently, without storage). Rejected — transient handling still means
  raw card data transits FraterUnion-controlled infrastructure and could
  be logged, cached, or intercepted there; provider-hosted collection
  avoids this entirely.
- **Storing encrypted PAN.** Rejected — encryption at rest does not remove
  PAN from FraterUnion's compliance scope or eliminate the risk of
  mishandling during the encrypt/decrypt lifecycle; there is no product
  requirement that justifies taking on this risk.

## Implementation implications

- Request DTOs across the API must not include PAN or CVC fields; this is
  a structural constraint on the API surface, not just a validation rule.
- Logging and error-reporting paths require redaction sufficient to
  guarantee sensitive payment credentials cannot appear in captured
  output, per
  [`../architecture/security-boundaries.md`](../architecture/security-boundaries.md#card-data-boundary).
- Frontend applications (admin, and any future consumer-facing surfaces
  FraterUnion builds) must use provider-controlled components for card
  entry, never custom card-input fields that submit to FraterUnion.
- Automated tests must verify that sensitive fields are rejected if
  submitted, so this boundary is enforced continuously, not only by
  convention.
- Documentation and examples must never include real or realistic-looking
  card data, including in fixtures or sample payloads.

## Revisit conditions

None are anticipated under the current business model. Any proposal to
handle raw card data directly would require executive, legal, security,
and compliance review, and would need to be recorded as a new ADR that
explicitly supersedes this one — it cannot be reversed by an incremental
engineering decision.

This ADR does not claim, and must not be read as claiming, any specific
PCI DSS SAQ classification or other compliance certification; see
[`../architecture/security-boundaries.md`](../architecture/security-boundaries.md#pci-scope-strategy).
