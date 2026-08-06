# ADR-010: UTC time and ISO currencies

## Status

Accepted

Last updated: 2026-08-06

## Context

FraterUnion tenants operate in multiple countries, and billing/settlement
timing is sensitive to timezone handling errors — an off-by-one-timezone
bug in a billing scheduler can charge a customer a day early or late. UTC
storage alone solves consistent ordering and comparison, but is
insufficient by itself for recurring, locally-anchored business rules (for
example, "bill on the 1st of the month in the tenant's local time"), which
require retaining the originating timezone, not just an instant in UTC.
Currency identification needs a shared, unambiguous vocabulary consistent
with what payment providers use.

## Decision

- All timestamps are stored in UTC.
- Timestamp columns use timezone-aware types, not naive/local timestamps.
- APIs represent timestamps using ISO 8601, in UTC, unless a field
  explicitly represents a local date rather than an instant.
- Currency codes use ISO 4217, uppercase, everywhere in the system —
  consistent with the currency requirement in ADR-009.
- Business-local dates and billing schedules (see
  [`../architecture/subscription-lifecycle.md`](../architecture/subscription-lifecycle.md#billing-scheduler-expectations))
  retain an explicit IANA timezone identifier wherever local semantics
  actually matter, rather than being derived from UTC alone.
- Billing semantics are never derived solely from server local time.

## Consequences

### Positive

- Consistent storage, comparison, and ordering of events across the
  entire system, regardless of where a request originated.
- ISO 8601 and ISO 4217 are unambiguous, widely understood standards that
  match what payment providers and most external systems already use.
- Retaining an explicit IANA timezone for local business rules avoids the
  class of bug where a recurring schedule silently drifts across
  daylight-saving transitions.

### Negative

- Explicit timezone conversion is required at presentation boundaries
  (displaying a UTC timestamp in a tenant's local time) rather than being
  implicit.
- Daylight-saving transitions require careful, tested handling wherever a
  billing period or schedule is computed from a local-time rule.
- Two related concepts — an instant (UTC timestamp) and a local business
  date (day/time plus IANA zone) — must be modeled and reasoned about
  separately, which is more complex than treating all times as
  interchangeable.

### Risks and mitigations

- **A recurring billing rule is computed from server local time instead of
  the tenant's intended zone.** Mitigated by the explicit rule that
  billing semantics are never derived solely from server local time, and
  by requiring an IANA zone to be stored wherever local semantics matter
  (see [`../architecture/subscription-lifecycle.md`](../architecture/subscription-lifecycle.md#billing-scheduler-expectations)).
- **A daylight-saving transition shifts a scheduled billing time
  unexpectedly.** Mitigated by requiring tests that specifically cover
  daylight-saving transitions for any schedule-computation logic (see
  [Implementation implications](#implementation-implications)).
- **A currency code is accepted in a non-standard or lowercase form,
  causing mismatches.** Mitigated by validating currency codes against an
  approved ISO 4217 list and normalizing to uppercase at input
  boundaries.

## Alternatives considered

- **Server-local time.** Rejected — ties correctness to wherever the
  server happens to be deployed, which is both arbitrary and subject to
  change.
- **Tenant-local timestamps stored without an explicit zone.** Rejected —
  a timestamp without zone information is ambiguous and cannot be
  correctly converted or compared later, especially across daylight-saving
  changes.
- **UTC-only recurring schedule rules** (no retained originating
  timezone). Rejected — this is precisely what breaks local business
  rules like "bill on the 1st" across daylight-saving transitions; the
  originating zone must be retained, not discarded after an initial UTC
  conversion.
- **Numeric timezone offsets as permanent identifiers** (for example,
  storing `-05:00` instead of an IANA zone like `America/Mexico_City`).
  Rejected — a fixed offset does not capture daylight-saving rules and
  becomes incorrect across DST transitions; IANA zone identifiers encode
  the actual rules for a location.
- **Free-form currency strings.** Rejected — ambiguous and inconsistent
  with ADR-009's requirement for explicit, standardized currency codes.

## Implementation implications

- Database timestamp columns must be timezone-aware (for example,
  PostgreSQL's `timestamptz`), not naive timestamp types.
- APIs return timestamps in UTC using ISO 8601 unless a field is
  explicitly documented as representing a local date rather than an
  instant.
- Future subscription/billing schedules store an explicit IANA timezone
  identifier alongside any local-time business rule.
- Tests covering schedule computation must include cases spanning
  daylight-saving transitions, not only "normal" dates.
- Currency validation uses an approved ISO 4217 list rather than accepting
  arbitrary strings.
- Provider-specific currency representations (if a provider uses a
  non-standard code or format) are mapped explicitly to ISO 4217 at the
  adapter boundary, consistent with ADR-004's mapping-boundary principle.

## Revisit conditions

- A regulatory requirement demands an additional local-date representation
  beyond what is described here.
- Support for a non-ISO currency representation, or a digital asset,
  is proposed — this requires a new ADR rather than an extension of this
  one, consistent with the currency-representation boundary this ADR
  establishes.
