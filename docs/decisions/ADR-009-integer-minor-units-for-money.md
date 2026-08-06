# ADR-009: Integer minor units for money

## Status

Accepted

Last updated: 2026-08-06

## Context

Binary floating-point representation of monetary amounts produces unsafe
behavior (rounding errors, non-associative arithmetic) that is unacceptable
anywhere money is calculated, stored, or compared — which is effectively
everywhere in FraterUnion Payments. Payment providers, including Stripe,
generally accept and report amounts as integers in a currency's smallest
unit. Not every currency uses two decimal places (some use zero, some use
three), so a design that assumes a fixed exponent would be incorrect for
currencies FraterUnion Payments may need to support later.

## Decision

- Monetary amounts are represented as integers in the smallest supported
  unit of the currency (its "minor unit" — for example, cents for USD).
- Every monetary amount carries an explicit ISO 4217 currency code; no
  amount is ever assumed to be in a default currency.
- Floating-point numbers are forbidden for monetary calculations, at rest,
  in transit, and in application logic.
- Currency metadata determines the exponent (number of minor-unit digits)
  where needed, rather than assuming two decimal places universally.
- Rounding rules must be explicit at any boundary where rounding is
  unavoidable (for example, currency conversion or proration, both of
  which remain future work — see
  [`../architecture/subscription-lifecycle.md`](../architecture/subscription-lifecycle.md#plan-changes)).

## Consequences

### Positive

- Deterministic calculations: the same inputs always produce the same
  monetary result, with no floating-point representation error.
- Direct compatibility with how payment providers, including Stripe,
  represent amounts.
- Matches the integer-minor-units requirement already established for the
  ledger (see
  [`../architecture/ledger-principles.md`](../architecture/ledger-principles.md#core-principles)).

### Negative

- Developers must understand currency exponents rather than assuming
  "divide by 100" universally; getting this wrong for a non-two-decimal
  currency would silently misrepresent amounts.
- Formatting for display (adding decimal points, currency symbols) must be
  handled as a presentation concern, separate from storage and
  calculation, adding a layer most floating-point-based code skips.
- Any point where amounts are received from or sent to a system that uses
  decimal representation (some third-party APIs, human input) requires an
  explicit, tested conversion step.

### Risks and mitigations

- **A currency with a non-standard exponent (for example, a zero-decimal
  or three-decimal currency) is handled as if it had two decimals.**
  Mitigated by requiring currency exponent to be looked up from currency
  metadata rather than hardcoded, and by requiring tests to cover
  zero-decimal and three-decimal currencies conceptually (see
  [Implementation implications](#implementation-implications)), even
  before the product actually supports such a currency.
- **A floating-point value enters the system from an external API or
  human input and is stored without conversion.** Mitigated by validating
  that amounts are integers at every input boundary, rejecting
  floating-point or decimal-string values that aren't first converted
  deliberately.
- **Implicit currency conversion silently changes an amount's meaning.**
  Mitigated by the explicit rule that conversion between currencies is
  never implicit (see Decision above); any conversion is a deliberate,
  visible operation.

## Alternatives considered

- **Floating point.** Rejected outright — well-documented to produce
  unsafe results for monetary arithmetic; not an acceptable tradeoff
  anywhere in a payments platform.
- **Decimal strings everywhere** (representing amounts as strings like
  `"100.00"` throughout the system). Rejected as the primary
  representation — pushes parsing and arithmetic-safety concerns to every
  consumer of the value, rather than establishing one safe representation
  centrally.
- **An arbitrary-precision decimal type as the primary API/storage
  representation.** Rejected as unnecessary for money, which has a
  well-defined smallest unit per currency; integers in minor units are
  simpler and match what providers already use.
- **Assuming all currencies have two decimal places.** Rejected — this is
  false for real currencies FraterUnion Payments may need to support
  (for example, currencies with zero or three decimal places), and would
  produce silently incorrect amounts if assumed universally.

## Implementation implications

- A future shared `Money` value object (in a domain or shared package) is
  expected to encapsulate amount-plus-currency and enforce these rules
  centrally, rather than every call site handling raw integers and
  currency codes separately.
- Amount validation must reject non-integer or negative-where-inappropriate
  values at API boundaries.
- Every financial record (payment, refund, ledger entry) requires an
  explicit currency code field; there is no implicit default currency.
- Conversion between currencies, if and when introduced, is always an
  explicit, auditable operation — never implicit within an otherwise
  same-currency calculation.
- Database columns storing monetary amounts must use integer types large
  enough to hold realistic amounts in minor units without overflow.
- Tests must cover zero-decimal (for example, conceptually, currencies
  like JPY) and three-decimal (for example, conceptually, currencies like
  KWD) exponent handling, even if the initial product only actually
  supports a narrower set of currencies.

## Revisit conditions

No reversal of this decision is expected. A future ADR may add decimal
accounting requirements for contexts outside payment amounts themselves
(for example, a tax-rate percentage), but any such addition must not
silently replace the integer-minor-units representation established here
for money.
