# ADR-002: PostgreSQL and Prisma

## Status

Accepted

Last updated: 2026-08-06

## Context

Payments and the internal ledger (see
[`../architecture/ledger-principles.md`](../architecture/ledger-principles.md))
require transactional writes, relational integrity, and strong
consistency: a payment, its ledger entries, and its outbox event must
either all persist or none do. The datastore needs to support the
organization-scoped multi-tenancy model (ADR-003) efficiently, and the
team has existing familiarity with PostgreSQL and Prisma, which reduces
delivery risk on a system where correctness matters more than trying new
tools.

## Decision

- PostgreSQL is the primary transactional datastore for FraterUnion
  Payments.
- Prisma is the initial ORM and migration tool.
- PostgreSQL is the system of record for both operational (payments,
  customers, subscriptions) and ledger state — not a cache or a
  read-replica of some other source of truth.
- A managed PostgreSQL provider (for example, Neon, per
  [`../architecture/system-context.md`](../architecture/system-context.md#deployment-model))
  is acceptable for the initial deployment.
- Raw SQL remains allowed, and expected, wherever Prisma cannot express a
  correctness- or performance-critical query adequately (for example,
  ledger balance invariants or advisory locking).

## Consequences

### Positive

- Strong transactional semantics (ACID) directly support the ledger's
  balanced-transaction and append-only invariants.
- Relational modeling fits the platform's inherently relational data
  (organizations, customers, payments, ledger entries, webhooks all
  reference each other).
- A single, well-understood datastore for both operational and financial
  state simplifies reasoning about consistency, compared to splitting
  them across different systems.

### Negative

- Prisma's query capabilities and generated types have limits; some
  queries (bulk ledger aggregation, complex locking) will require raw
  SQL, increasing the surface area that isn't covered by Prisma's
  type-safety.
- Migration discipline becomes a hard requirement: an unreviewed or
  unsafe migration against a financial schema is a severe risk, not a
  minor inconvenience.
- Managed/serverless PostgreSQL providers have connection-handling
  characteristics (connection limits, cold starts, pooling behavior) that
  must be accounted for in how the API and worker connect.

### Risks and mitigations

- **Prisma masking unsafe schema changes.** Mitigated by requiring
  migrations to be explicit, reviewed, and generated (not applied via
  unsafe schema push) in any deployed environment — see
  [Implementation implications](#implementation-implications).
- **Connection exhaustion against a managed/serverless database.**
  Mitigated by requiring explicit connection-pool configuration
  appropriate to the deployment target chosen when the database is
  actually provisioned.
- **Correctness gaps where Prisma's query language is insufficient.**
  Mitigated by explicitly allowing raw SQL for these cases rather than
  forcing an awkward Prisma-only expression of a critical invariant.

## Alternatives considered

- **MongoDB** — weaker fit for the ledger's relational, strongly
  consistent, invariant-heavy data model.
- **DynamoDB** — optimized for a different access-pattern shape than a
  relational ledger and multi-tenant domain model requires; would push
  relational integrity into application code.
- **MySQL** — a viable relational alternative, but PostgreSQL's
  constraint, transaction, and extension ecosystem is better suited to
  the ledger's requirements and is what the team has direct experience
  with.
- **CockroachDB** — offers distributed SQL properties not currently
  needed at FraterUnion Payments' expected scale; reconsider only if
  geographic distribution becomes a real requirement (see
  [Revisit conditions](#revisit-conditions)).
- **Drizzle** — a lighter-weight, SQL-forward alternative to Prisma;
  rejected for now in favor of Prisma's more mature migration tooling and
  the team's existing familiarity, without ruling out reconsideration.
- **TypeORM** — considered and rejected in favor of Prisma's schema-first
  workflow and generated client, which the team has more direct
  experience with.
- **SQL-only data access (no ORM at all)** — rejected as the default for
  application code, since it would remove Prisma's type-safety and
  migration tooling for the majority of straightforward queries; raw SQL
  remains available for the specific cases described above.

## Implementation implications

- Any write that touches money (payment state, ledger entries, refunds)
  must occur inside a database transaction; partial writes across these
  concerns are not acceptable.
- Database constraints (foreign keys, check constraints, uniqueness)
  should enforce invariants directly wherever practical, rather than
  relying solely on application-level validation.
- Migrations must be reviewed and tested before being applied to any
  shared or production environment.
- Production migrations must use generated, reviewed migration files —
  never an unsafe/unreviewed schema push.
- Connection pooling must be explicitly configured for whatever
  deployment environment is chosen (see
  [`../architecture/system-context.md`](../architecture/system-context.md#deployment-model)),
  accounting for that environment's connection limits.

## Revisit conditions

- PostgreSQL (including managed offerings) cannot satisfy a concrete
  geographic-distribution or scaling requirement that emerges from actual
  usage.
- Prisma is found to prevent a correctness or performance requirement
  that raw SQL cannot reasonably work around.
- Operational evidence (not speculation) justifies a different
  data-access layer or datastore for a specific, well-defined workload.
