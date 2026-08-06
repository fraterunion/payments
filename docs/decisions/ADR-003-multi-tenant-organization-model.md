# ADR-003: Multi-tenant organization model

## Status

Accepted

Last updated: 2026-08-06

## Context

FraterUnion Payments serves multiple FraterUnion products (GymOS,
RestaurantOS, PlazaOS, WristOS, UMA Temple of Beauty, SugarOS, and future
products) as tenants of one platform (see
[`../product/vision.md`](../product/vision.md)). The platform needs a
tenancy model now, before any tenant-owned data exists, because retrofitting
isolation onto an already-built schema is far riskier than designing it in
from the start. Operational simplicity matters during the initial phase —
the team is small and the platform is new — while the consequence of an
isolation failure (one tenant reading or mutating another tenant's payment
or customer data) is severe regardless of scale.

## Decision

- FraterUnion Payments uses a shared application and a shared PostgreSQL
  database for all tenants initially — not database-per-tenant or
  schema-per-tenant.
- Every tenant-owned record carries an explicit `organizationId`.
- Organization identity for a request or job is derived from authenticated
  context (a resolved API key, session, or service credential) — never
  from a client-supplied value.
- Provider accounts, API keys, customers, payments, ledger records, and
  webhooks are all organization-scoped.
- Cross-tenant access is forbidden at every layer, including for
  background jobs.
- Background jobs must carry and validate organization context as part of
  their payload, not infer it implicitly.
- PostgreSQL row-level security (RLS) is not mandatory initially, but
  remains available as a possible additional defense layer.

## Consequences

### Positive

- Lower infrastructure complexity and operational overhead than
  database-per-tenant or schema-per-tenant, appropriate for the platform's
  current stage and team size.
- One schema, one migration path, and one deployment to reason about.
- Cross-tenant reporting and platform-operator tooling are naturally
  simpler against a shared database than across many isolated databases.

### Negative

- Every query and command that touches tenant-owned data requires explicit
  tenant awareness; there is no structural (database-level) guarantee of
  isolation unless RLS is later adopted.
- A missing `organizationId` filter is a data-isolation bug, not merely a
  correctness bug — the consequence of an omission is significantly higher
  than in a single-tenant system.
- Isolation depends on application-layer discipline (scoped
  repositories/services, mandatory tests) rather than being enforced by
  infrastructure by default.

### Risks and mitigations

- **A missing tenant filter leaks or mutates cross-tenant data.** Mitigated
  by requiring tenant-isolation tests for any endpoint or job touching
  tenant-owned data (see
  [`../architecture/security-boundaries.md`](../architecture/security-boundaries.md#multi-tenancy-boundary)),
  and by routing data access through scoped repositories/services rather
  than ad hoc queries.
- **A client supplies a forged or incorrect `organizationId`.** Mitigated
  by deriving organization identity exclusively from authenticated
  context, never from request bodies, as stated in the Decision above.
- **A background job processes the wrong tenant's data.** Mitigated by
  requiring jobs to carry validated organization context as part of their
  payload/contract, not to infer it from ambient state.

## Alternatives considered

- **Database per tenant.** Strongest isolation, but operationally heavy at
  this stage (per-tenant provisioning, migrations, connection management)
  for a platform with a modest and initially-known set of tenants.
  Reconsidered if a specific tenant later requires dedicated
  infrastructure (see [Revisit conditions](#revisit-conditions)).
- **Schema per tenant.** Reduces cross-tenant query risk somewhat versus a
  fully shared schema, but multiplies migration and connection-management
  complexity similarly to database-per-tenant, without matching its
  isolation guarantees.
- **Separate deployment per product.** Would eliminate a shared payments
  platform's core value proposition (see
  [`../product/vision.md`](../product/vision.md#strategic-problem)) by
  reintroducing per-product duplication of payment logic.
- **PostgreSQL row-level security from day one.** A stronger
  defense-in-depth posture, deliberately deferred rather than rejected:
  RLS adds real operational and query-planning complexity, and the team
  judged application-layer enforcement plus mandatory isolation tests
  sufficient for the current stage, with RLS available as a future
  addition without requiring a schema redesign.

## Implementation implications

- `organizationId` from a request body or unauthenticated source must
  never be treated as authoritative for authorization decisions.
- Composite uniqueness constraints commonly need to include
  `organizationId` (for example, an idempotency key is unique per
  organization, not globally).
- Resource identifiers (IDs) must not, by themselves, imply authorization
  to access that resource — access still requires the resolved
  organization context to match.
- Logs, metrics, and job payloads should include organization context for
  traceability and debugging, without leaking one tenant's data into
  another tenant's visible output.
- Administrative operations that legitimately span tenants (platform
  operator tooling) require explicit, privileged code paths, distinct from
  ordinary tenant-scoped access, and must be audited (see
  [`../architecture/security-boundaries.md`](../architecture/security-boundaries.md#administrative-boundary)).

## Revisit conditions

- A regulatory or contractual requirement mandates physical or logical
  data isolation beyond what shared-database, organization-scoped
  multi-tenancy provides.
- A specific large tenant requires dedicated infrastructure for
  performance, contractual, or risk-isolation reasons.
- Operational evidence (incidents, audit findings, or scale) supports
  adopting row-level security or a database-per-tenant model for some or
  all tenants.
