# Architecture Decision Records

## Status

Authoritative. This index and the ADRs it links to are binding on
implementation, in the same sense as the documents in
[`../architecture/`](../architecture/) and [`../product/`](../product/):
code must follow them, not the reverse.

Last updated: 2026-08-06

## What an ADR is

An Architecture Decision Record (ADR) captures one significant, hard-to-reverse
technical or product decision: what was decided, why, what alternatives were
rejected and why, and what consequences and constraints the decision creates
for future work. An ADR is not a design document, a how-to guide, or a
restatement of the product/architecture documentation — it exists to make the
_reasoning_ behind a decision durable, so that future contributors do not have
to guess why something is the way it is, or accidentally re-litigate a
decision without knowing it was already made deliberately.

## When a new ADR is required

Not every choice needs an ADR. An ADR is required when a change would:

- Change a major framework (for example, moving off NestJS, Next.js, or
  TypeScript).
- Change database technology (for example, moving off PostgreSQL, or
  replacing Prisma with a fundamentally different data-access strategy).
- Change tenancy strategy (for example, moving from shared-database
  multi-tenancy to database-per-tenant).
- Add a new provider-integration pattern (for example, a routing or
  failover model spanning multiple providers).
- Change card-data boundaries (for example, any proposal to handle raw PAN
  or CVC).
- Change ledger semantics (for example, the accounting model, posting
  rules, or reversal strategy).
- Change consistency or event-delivery guarantees (for example, moving
  away from at-least-once delivery, or introducing distributed
  transactions).
- Introduce custody, payouts, PayFac, or Merchant of Record behavior.
- Adopt microservices or otherwise split the modular monolith described in
  [`../architecture/system-context.md`](../architecture/system-context.md).
- Change the money or time representation (for example, the integer
  minor-units or UTC-storage decisions below).

If a change does not fall into one of these categories, it is ordinarily an
implementation detail that belongs in code, tests, and, where useful, the
architecture documentation — not a new ADR.

## Statuses

- **Proposed** — under active consideration; not yet binding on
  implementation.
- **Accepted** — binding on implementation. The default status for a
  decision that has actually been made.
- **Deprecated** — no longer recommended for new work, but not yet fully
  replaced; existing implementations following it are not necessarily
  broken.
- **Superseded** — replaced by a specific later ADR, which is linked from
  the superseded record. See below.
- **Rejected** — considered and explicitly declined; recorded so the same
  proposal is not re-evaluated from scratch later without new information.

## ADRs are not silently rewritten

Once an ADR is Accepted, its Context, Decision, and Consequences sections are
not edited to reflect a change of mind. Minor corrections (typos, broken
links, clarifying wording that does not change the decision's meaning) are
acceptable. Anything that changes what was actually decided requires either:

- A **new ADR that supersedes it** — the old ADR's status changes to
  `Superseded`, with a link to the new ADR; the new ADR states what it
  supersedes and why.
- Marking it **Deprecated** or **Rejected**, if the decision is being
  retired rather than replaced by a specific alternative.

This preserves an accurate history of what was decided and when, even after
the platform's direction changes.

## Naming convention

ADR files are named `ADR-XXX-kebab-case-title.md`, where `XXX` is a
zero-padded, sequential, never-reused three-digit number (`001`, `002`, ...).
Numbers are assigned in the order ADRs are created and are never renumbered,
even if an earlier ADR is later superseded or rejected.

## Review expectations

An ADR proposing or recording a decision in one of the categories listed
above should be reviewed by whoever owns the affected area (technical
leadership for framework/database/tenancy decisions; security- and
compliance-conscious review for card-data, ledger, and custody-related
decisions) before being marked `Accepted`. ADRs documenting a decision that
has already been carefully made — as is the case for the initial ADRs in
this repository — are reviewed for accuracy and clarity rather than
re-debated.

## Index

| #                                                        | Decision                                                       | Status   | Last updated |
| -------------------------------------------------------- | -------------------------------------------------------------- | -------- | ------------ |
| [ADR-001](./ADR-001-nestjs-nextjs-and-typescript.md)     | NestJS, Next.js, and TypeScript across the stack               | Accepted | 2026-08-06   |
| [ADR-002](./ADR-002-postgresql-and-prisma.md)            | PostgreSQL and Prisma as the transactional datastore           | Accepted | 2026-08-06   |
| [ADR-003](./ADR-003-multi-tenant-organization-model.md)  | Shared-database, organization-scoped multi-tenancy             | Accepted | 2026-08-06   |
| [ADR-004](./ADR-004-provider-abstraction.md)             | Payment providers behind framework-neutral contracts           | Accepted | 2026-08-06   |
| [ADR-005](./ADR-005-no-raw-card-data.md)                 | No raw card data (PAN/CVC) anywhere in the platform            | Accepted | 2026-08-06   |
| [ADR-006](./ADR-006-append-only-double-entry-ledger.md)  | Append-only, double-entry internal ledger                      | Accepted | 2026-08-06   |
| [ADR-007](./ADR-007-transactional-outbox-and-inbox.md)   | Transactional outbox and durable inbox, at-least-once delivery | Accepted | 2026-08-06   |
| [ADR-008](./ADR-008-provider-owned-merchant-accounts.md) | Provider-owned merchant accounts; no custody in v1             | Accepted | 2026-08-06   |
| [ADR-009](./ADR-009-integer-minor-units-for-money.md)    | Integer minor units, explicit ISO currency, for all money      | Accepted | 2026-08-06   |
| [ADR-010](./ADR-010-utc-time-and-iso-currencies.md)      | UTC storage, ISO 8601/4217 representation                      | Accepted | 2026-08-06   |
