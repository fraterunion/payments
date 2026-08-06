# ADR-004: Provider abstraction

## Status

Accepted

Last updated: 2026-08-06

## Context

FraterUnion Payments' core value proposition is decoupling FraterUnion
products from any single payment provider (see
[`../product/vision.md`](../product/vision.md#strategic-problem)). Stripe is
the first provider, but different countries and cost structures may
eventually require different providers, and direct provider coupling in
every consumer product is exactly the problem this platform exists to
avoid. At the same time, designing an abstraction for providers that do not
yet exist in the platform risks building the wrong abstraction; the
contracts need to be shaped by what Stripe actually requires first, while
remaining deliberately provider-neutral in naming and structure.

## Decision

- Payment providers are integrated through framework-neutral contracts
  defined in `@fraterunion-payments/provider-contracts`.
- Stripe is the first provider but is explicitly not part of the core
  domain — it is one implementation of the provider contracts.
- Internal normalized states and commands (see
  [`../architecture/payment-lifecycle.md`](../architecture/payment-lifecycle.md))
  are provider-independent; no Stripe-specific status or object shape is
  part of the domain model.
- Provider-specific identifiers and payloads (for example, a Stripe
  Payment Intent ID or its response shape) remain behind the adapter's
  mapping boundary and are not exposed to domain or ledger code.
- Consumer products integrate only with FraterUnion Payments' API and SDK
  — never directly with a provider.

## Consequences

### Positive

- A provider can be replaced or added without changing domain logic, the
  ledger, or consumer-product integrations — only a new or modified
  adapter.
- Consumer products are fully insulated from provider identity, which is
  the platform's core value proposition.
- Testing the domain and ledger does not require a real (or even mocked)
  provider SDK; adapters can be tested and mocked independently.

### Negative

- Every provider capability that domain code needs must be explicitly
  translated at the adapter boundary, which is more upfront work than
  calling a provider SDK directly.
- A shared contract risks becoming a lowest-common-denominator
  abstraction that cannot express a capability only some providers offer.
- Provider-specific behavior that genuinely cannot be generalized needs a
  deliberate design decision (an escape hatch), rather than being silently
  absorbed into the shared contract.

### Risks and mitigations

- **The abstraction is designed around Stripe's shape by accident, and
  breaks when a second provider is added.** Mitigated by naming and
  structuring `provider-contracts` around FraterUnion's own normalized
  concepts (see
  [`../architecture/payment-lifecycle.md`](../architecture/payment-lifecycle.md)),
  not Stripe's API shape, even though Stripe is currently the only
  implementation.
- **A required capability doesn't fit the shared contract.** Mitigated by
  requiring capability checks to be explicit (an adapter declares what it
  supports) rather than allowing silent, provider-specific fallback
  behavior; provider-specific extensions require deliberate design and
  documentation, not ad hoc special-casing.
- **Adapters silently diverge in behavior for the same nominal
  operation.** Mitigated by contract tests intended to validate every
  adapter against the same expected behavior for a given contract method.

## Alternatives considered

- **Direct Stripe usage in every consumer product.** This is the status
  quo problem the platform exists to solve (see
  [`../product/vision.md`](../product/vision.md#strategic-problem)); it
  was rejected as the reason for building FraterUnion Payments in the
  first place.
- **A Stripe-shaped internal domain** (modeling payments, customers, and
  status directly after Stripe's objects). Rejected because it would make
  adding a second provider require reshaping the domain model instead of
  writing an adapter, defeating the purpose of an abstraction.
- **One code path per consumer product.** Rejected for the same reasons as
  direct provider usage — it reintroduces duplicated payment logic across
  products.
- **A premature universal abstraction covering every future provider**
  (Helcim, Moneris, OpenPay, Conekta, Adyen, Mercado Pago, Nuvei) before
  any of them are integrated. Rejected because designing for hypothetical
  providers without their real constraints tends to produce an
  abstraction that fits none of them well; the contract will be extended
  and validated as real providers are added.

## Implementation implications

- Core/domain packages must not import a provider SDK, directly or
  transitively.
- Provider-specific packages (for example, a future
  `@fraterunion-payments/provider-stripe`) may depend on that provider's
  SDK freely.
- Adapters must make their supported capabilities explicit (for example,
  whether manual capture or setup intents are supported) rather than
  letting callers discover support by failure.
- Any provider-specific behavior exposed beyond the shared contract must
  be a deliberate, documented escape hatch — not an implicit special case
  buried in calling code.
- Contract tests should validate that every adapter satisfies the same
  behavioral expectations for each contract method it implements.

## Revisit conditions

- The current contract shape blocks a critical capability a provider
  offers and FraterUnion Payments needs.
- Real differences between providers, once a second provider is
  integrated, prove too large to express through one shared contract.
- A capability-specific extension to the contract is needed — this itself
  should be recorded as a new ADR rather than an undocumented contract
  change.
