# @fraterunion-payments/database

## Purpose

This package owns the PostgreSQL schema and Prisma client for FraterUnion
Payments. This package establishes the Prisma/PostgreSQL foundation and the
core multi-tenant identity schema: organizations, users, user credentials,
memberships, API keys, sessions, the audit log, the transactional
outbox / durable inbox tables, customers, customer-provider mappings,
canonical payments, canonical refunds, durable financial-operation
idempotency (`idempotency_records`), and canonical provider-account
connections (`provider_account_connections`). It intentionally does not
include ledger or webhook entities — see
[`../../docs/decisions/ADR-002-postgresql-and-prisma.md`](../../docs/decisions/ADR-002-postgresql-and-prisma.md)
and
[`../../docs/decisions/ADR-003-multi-tenant-organization-model.md`](../../docs/decisions/ADR-003-multi-tenant-organization-model.md)
for the accepted decisions this package implements.

This package does not implement a generic application-level repository
layer. It exposes the Prisma client and generated types; query patterns
belong to the applications that consume it.

## Prisma schema location

```text
packages/database/prisma/schema.prisma
```

Enums, models, field-level comments explaining non-obvious choices, and
`@map`/`@@map` database naming are all defined there. Migrations live in
`packages/database/prisma/migrations/`.

## Generated-client strategy

The Prisma schema uses the `prisma-client-js` generator, with output to
`packages/database/generated/client` (gitignored — never committed; every
consumer runs `prisma generate` locally or in CI before use).

This is a deliberate choice over Prisma's newer `prisma-client` generator
(now the default as of Prisma 7). `prisma-client` emits raw `.ts` source
that must be consumed with `moduleResolution: bundler` or
`allowImportingTsExtensions`; `apps/api` (NestJS) uses `module: commonjs`
with `moduleResolution: node`, which cannot resolve that output. Prisma
still ships `prisma-client-js` as a fully supported generator, producing a
conventional package with dual CommonJS/ESM `exports`, importable
unmodified from CommonJS, ESM/`NodeNext`, and bundler-resolved code alike —
matching every module system already in use across this monorepo (see
[ADR-001](../../docs/decisions/ADR-001-nestjs-nextjs-and-typescript.md)).

Prisma 7 requires an explicit **driver adapter** to connect
`PrismaClient` to a database, regardless of which generator is used — a
bare `DATABASE_URL` passed straight to the client constructor is no longer
accepted. This package uses `@prisma/adapter-pg` (backed by `pg`). See
[`src/client.ts`](./src/client.ts).

The package exposes a stable import surface rather than the generated
path directly:

```ts
import {
  createPrismaClient,
  PrismaClient,
  OrganizationStatus,
} from '@fraterunion-payments/database';
```

`createPrismaClient({ connectionString })` builds a **new**, independent,
**unconnected** client on every call — this package does not construct a
module-level singleton and does not connect to a database on import.
Connection lifecycle (when to `$connect`/`$disconnect`, how many clients to
hold) is owned by the consuming application (`apps/api`'s `DatabaseService`
in this repository), not by this package.

**This package's own `src/` is compiled** (`pnpm run build` →
`tsc -p tsconfig.build.json` → `dist/`, gitignored, matching `generated/`)
rather than exported as raw TypeScript source. Unlike the other minimal
`packages/*` placeholders, this package has real runtime logic that other
apps execute — not just typecheck against — and a consumer running already-
built code (`node dist/main.js`, no TypeScript compiler in the loop) cannot
resolve a `package.json#exports` entry pointing at a `.ts` file. `exports`
uses the `types`/`default` conditions to point `tsc` at `dist/index.d.ts`
and runtime resolution at `dist/index.js`.

**`$connect()` does not eagerly validate connectivity.** With Prisma 7's
driver-adapter model, `PrismaClient#$connect()` prepares the adapter but
the underlying connection pool connects lazily, per query — calling only
`$connect()` against an unreachable database resolves successfully instead
of rejecting. `createPrismaClient` accepts a `connectionTimeoutMillis`
option (default 10s, passed through to the underlying `pg.Pool`) so that a
consumer performing a real query — as `apps/api`'s `DatabaseService` does
during startup, deliberately, for exactly this reason — fails within a
bounded time instead of hanging indefinitely.

## Local setup

1. Have a PostgreSQL 16+ server reachable locally (Homebrew, a system
   package, or your own container runtime — this repository does not
   include Docker Compose).
2. Create a local development database, for example:

   ```bash
   createdb fraterunion_payments_dev
   ```

3. Create `packages/database/.env` (gitignored, never committed) with a
   connection string in the standard PostgreSQL URL format:

   ```env
   DATABASE_URL="postgresql://<user>:<password>@localhost:5432/fraterunion_payments_dev"
   ```

   `<password>` may be omitted for a local trust-authenticated database.
   The repository root's [`.env.example`](../../.env.example) reserves the
   `DATABASE_URL` key; this package's own `.env` is what Prisma CLI
   commands actually read (via `prisma.config.ts`), since each app/package
   owns its own runtime configuration.

4. Generate the client and apply migrations (see [Commands](#commands)
   below).

## Environment requirements

| Variable       | Required for                                                                      | Notes                                                |
| -------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL` | `db:migrate:*`, `db:seed`, `db:studio`, and any code calling `createPrismaClient` | Standard PostgreSQL connection URL. Never committed. |

`prisma.config.ts` loads `packages/database/.env` via `dotenv/config`.
`db:generate`, `db:format`, and `db:validate` only read the schema file and
do not require a reachable database.

## Commands

Run from the repository root:

```bash
pnpm db:generate        # generate the Prisma client into generated/client
pnpm db:format          # format prisma/schema.prisma
pnpm db:validate        # validate prisma/schema.prisma
pnpm db:migrate:dev     # create and apply a migration in development
pnpm db:migrate:deploy  # apply pending migrations (CI/production; never generates new ones)
pnpm db:seed            # run the development seed
pnpm db:studio          # open Prisma Studio against DATABASE_URL
```

Each forwards to `@fraterunion-payments/database`'s own script of the same
name via `pnpm --filter`. `db:migrate:deploy` never runs automatically as
part of `pnpm build`; it is a deliberate, separate operation.

`typecheck`, `test`, and `build` for this package each run `db:generate`
first, so a clean checkout produces a working client before type-checking,
testing, or being consumed by another package's build — no manual
generation step is required beyond having `DATABASE_URL` unset being
acceptable for `generate` (schema-only, no connection needed). `build`
additionally compiles `src/` to `dist/` (see
[Generated-client strategy](#generated-client-strategy)) — any package
depending on `@fraterunion-payments/database` needs `pnpm --filter
@fraterunion-payments/database run build` (or `pnpm build` at the root,
which orders it correctly via Turborepo's dependency graph) to have run at
least once.

## Migration workflow

Migrations are created with `prisma migrate dev`, never with
`prisma db push` — every schema change is a reviewable, committed SQL file
under `prisma/migrations/`, consistent with
[ADR-002](../../docs/decisions/ADR-002-postgresql-and-prisma.md)'s
requirement that production migrations be generated and reviewed, not
pushed. The initial migration is named `init_core_tenancy`; authentication
credentials and session-rotation fields were added in
`add_authentication_credentials`. Canonical email uniqueness — a functional
unique index on `LOWER(users.email)` — was added in
`enforce_canonical_email_uniqueness`. Prisma cannot declare expression
indexes in `schema.prisma`, so that invariant is maintained in the
migration SQL. The Prisma `@unique` on `User.email` is retained so
`findUnique` / `upsert` still resolve by the canonical value the
application always writes. Transactional outbox and inbox tables were
added in `add_transactional_outbox_and_inbox`, including CHECK
constraints Prisma cannot declare (processed timestamp, claim fields,
non-empty identity strings, and inbox `scopeKey` consistency).
Append-only `audit_logs` protection — the mutation trigger, actor CHECK,
non-empty action/resource CHECKs, JSON-object metadata CHECK, Restrict
actor FKs, and tenant-scoped indexes — was added in
`enforce_immutable_audit_logs`. Canonical customers and provider mappings
were added in `add_customers_and_provider_mappings`, including status/
archive consistency, non-empty optional text, JSON-object metadata, and
provider-account-scope CHECKs Prisma cannot declare. Canonical payments
and the narrow `payment_create_idempotency_keys` table were added in
`add_payments`, including BIGINT monetary CHECKs, currency shape, failure
consistency, object metadata, and the nullable composite customer FK.
Canonical refunds and the generalized `idempotency_records` table were
added in `add_refunds` (timestamp `20260902170000`, after
`20260902150000`). That migration copies existing payment-create
idempotency rows into `idempotency_records` with `scope = payment.create`
before dropping the narrow table, and adds refund monetary CHECKs,
composite payment/tenant FK, and failure-field consistency.
Financial-command idempotency was hardened in
`harden_financial_idempotency` (timestamp `20260902180000`): status
`IN_PROGRESS` / `COMPLETED` (existing rows backfilled `COMPLETED`),
`updated_at`, scope/resource-type shape CHECKs, and a status index.
Existing `payment.create` / `refund.create` key hashes and fingerprints
were not rewritten. New migration timestamps must sort after the latest
already-committed migration (`20260902180000` at the time of that
commit).

Before committing a migration:

- Read the generated SQL. Confirm enum values, column types, defaults,
  indexes, and `ON DELETE`/`ON UPDATE` behavior match what the schema
  comments describe.
- Name the directory so its timestamp sorts **after** the latest already-
  committed migration. Prisma applies files in directory-name order.
  Do not rename a migration that has already been applied.
- Apply it against a real local PostgreSQL database with
  `pnpm db:migrate:dev` — this package's correctness (especially foreign
  key and uniqueness behavior) is validated against real PostgreSQL, not
  SQLite or an in-memory substitute.

`prisma migrate deploy` is the non-interactive command intended for CI/
production pipelines; it applies already-generated migrations and never
creates new ones.

## Seed behavior

`prisma/seed.ts` seeds exactly three records, for local development only:

- An **internal** organization (`slug: fraterunion`, `type: INTERNAL`)
  representing FraterUnion's own operational tenant.
- A clearly fictional **development user**
  (`developer@fraterunion.local`) — not a real credential.
- An `OWNER` membership linking the two.

Every write is an `upsert` keyed on a unique field (`slug`, `email`, and
the `(organizationId, userId)` composite), so running `pnpm db:seed`
repeatedly is safe and never creates duplicates — verified by running it
twice in a row during validation of this commit. The seed creates no API
key, no session, and no payment data, and contains no real credentials.

## Naming conventions

- Prisma model names: PascalCase (`OrganizationMembership`).
- Prisma field names: camelCase (`organizationId`).
- PostgreSQL table/column names: snake_case, via explicit `@@map`/`@map`
  (`organization_memberships`, `organization_id`).
- Primary keys: UUID, native PostgreSQL `uuid` columns
  (`@db.Uuid`), generated client-side as **UUIDv7** via `@default(uuid(7))`
  rather than the more common UUIDv4. UUIDv7 embeds a timestamp prefix,
  giving primary keys roughly time-ordered insertion locality — better
  B-tree index behavior than fully random UUIDv4 — while remaining a
  standard, native `uuid` column. No sequential integer IDs are exposed
  anywhere.
- `createdAt`/`updatedAt`: present on every model except `AuditLog`, which
  is append-only by design and has no `updatedAt` (see below).
- Enum values: written in the schema as Prisma expects, mapped to
  snake_case PostgreSQL enum type names via `@@map` (for example, the
  `ApiEnvironment` Prisma enum maps to the `api_environment` PostgreSQL
  type).

**Naming note — `ApiEnvironment`, not `Environment`:** the schema's
test/live enum is named `ApiEnvironment` rather than the more generic
`Environment` specifically to avoid collision with runtime-environment
terminology (`NODE_ENV`, "which deployment environment is this"). Those are
independent axes — a `TEST`-environment API key can exist in a
production-deployed application — and reusing the word "environment" for
both would invite exactly that confusion in code and code review.

## Tenant-ownership rule

Every tenant-owned model (`OrganizationMembership`, `ApiKey`, `AuditLog`,
`Customer`, `CustomerProviderMapping`, `ProviderAccountConnection`, `Payment`, `Refund`,
`IdempotencyRecord`)
carries an explicit `organizationId` foreign key — never an implicit or
inferred tenant scope. Per
[ADR-003](../../docs/decisions/ADR-003-multi-tenant-organization-model.md),
tenant identity for a request or job must be derived from authenticated
context, never trusted from a request body; this schema only defines the
column, the trust boundary is enforced by the application layer that will
consume it.

## Relation and deletion policy

The guiding principle: **organizations are never physically deleted
through ordinary product flows, and nothing about removing a user or
revoking an API key may destroy audit history.** Concretely:

| Relation                                                  | On delete  | Why                                                                                                          |
| --------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `OrganizationMembership.organization` → `Organization`    | `Restrict` | An organization cannot be deleted while any membership references it — deactivate via `status` instead.      |
| `OrganizationMembership.user` → `User`                    | `Cascade`  | A membership has no meaning once the user it refers to is gone.                                              |
| `ApiKey.organization` → `Organization`                    | `Restrict` | Same rationale as above.                                                                                     |
| `ApiKey.createdByUser` → `User`                           | `SetNull`  | An API key (active or revoked) must outlive the user who created it; only the creator reference is cleared.  |
| `Session.user` → `User`                                   | `Cascade`  | Sessions are ephemeral security state, not historical/audit records.                                         |
| `Session.createdBySession` → `Session` (self)             | `SetNull`  | A rotation chain's earlier links may be pruned without invalidating the chain pointer of surviving rows.     |
| `UserCredential.user` → `User`                            | `Cascade`  | A credential has no meaning once its user is gone; unlike `AuditLog`, this is not a historical record.       |
| `AuditLog.organization` → `Organization`                  | `Restrict` | Audit history is tied to a tenant that must exist.                                                           |
| `AuditLog.actorUser` → `User`                             | `Restrict` | Audit rows keep the original actor id. Users are deactivated, not physically deleted, while evidence exists. |
| `AuditLog.actorApiKey` → `ApiKey`                         | `Restrict` | Same rationale: revoke API keys rather than deleting rows that audit references.                             |
| `OutboxEvent.organization` → `Organization`               | `Restrict` | Tenant-owned events keep their organization; platform events have a null `organizationId`.                   |
| `InboxEvent.organization` → `Organization`                | `Restrict` | Same rationale as the outbox.                                                                                |
| `Customer.organization` → `Organization`                  | `Restrict` | Customers are archived, never cascade-deleted with a tenant.                                                 |
| `CustomerProviderMapping.organization` → `Organization`   | `Restrict` | Mappings stay with the tenant.                                                                               |
| `CustomerProviderMapping.customer` → `Customer`           | `Restrict` | Composite `(customerId, organizationId)` so a mapping cannot attach to another tenant's customer.            |
| `Payment.organization` → `Organization`                   | `Restrict` | Payments are durable financial records; tenants are not cascade-deleted.                                     |
| `Payment.customer` → `Customer`                           | `Restrict` | Nullable composite `(customerId, organizationId)`; MATCH SIMPLE when `customerId` is null.                   |
| `Refund.organization` → `Organization`                    | `Restrict` | Refunds are durable financial history; tenants are not cascade-deleted.                                      |
| `Refund.payment` → `Payment`                              | `Restrict` | Composite `(paymentId, organizationId)` so a refund cannot attach to another tenant's payment.               |
| `IdempotencyRecord.organization` → `Organization`         | `Restrict` | Idempotency records stay with the tenant. Resource identity is stored, not a polymorphic FK.                 |
| `ProviderAccountConnection.organization` → `Organization` | `Restrict` | Merchant connections are operational history; tenants are not cascade-deleted.                               |

No relation cascades into `AuditLog` or deletes `Organization`/`ApiKey`
rows as a side effect of an unrelated deletion. Soft-delete fields were not
added reflexively to every model; `Organization`, `User`, and `ApiKey`
already have a `status`/lifecycle enum, and deactivation is expressed
through that status rather than a parallel `deletedAt` column.

## Indexing strategy

Indexes were added for known query shapes, not speculatively:

- `Organization`: `status`, `type` — operator/admin filtering.
- `User`: `status` — admin filtering. Email uniqueness is two complementary
  indexes: Prisma's byte-for-byte `users_email_key` (`@unique`, required
  for `findUnique` / `upsert`) and the SQL-only functional unique index
  `users_email_lower_uidx` on `LOWER(email)`. The functional index is not
  representable in `schema.prisma` and is therefore not declared there;
  `prisma migrate diff` against a database that has it produces an empty
  script, so normal Prisma workflows do not try to drop it.
- `OrganizationMembership`: `organizationId`, `userId` (plus the
  `(organizationId, userId)` unique constraint, which already indexes that
  pair — no redundant composite index added).
- `ApiKey`: `(organizationId, environment, status)` for the common
  "this org's active test/live keys" lookup, plus a standalone `status`
  index; `secretHash` and `(organizationId, keyPrefix)` are unique
  constraints, which already provide their own lookup indexes.
- `Session`: `userId`, `expiresAt` (for expiry sweeps), `sessionFamilyId`
  (for family-wide revocation on reuse detection); `tokenHash` and
  `createdBySessionId` are unique constraints, already indexed.
- `AuditLog`: tenant-scoped query shapes only —
  `(organizationId, createdAt)` for newest-first reads,
  `(organizationId, action, createdAt)`,
  `(organizationId, resourceType, resourceId, createdAt)`,
  `(organizationId, actorUserId, createdAt)`,
  `(organizationId, actorApiKeyId, createdAt)`, and
  `(organizationId, requestId)`. Unscoped actor/action/resource indexes
  were replaced in `enforce_immutable_audit_logs` because every
  legitimate read is organization-scoped.
- `OutboxEvent`: `(status, availableAt)` for the claim queue,
  `(status, claimExpiresAt)` for expired-lease recovery, plus
  `organizationId`, `eventType`, `(aggregateType, aggregateId)`, and
  `createdAt`.
- `InboxEvent`: unique `(scopeKey, source, externalEventId)` for
  deduplication, plus `organizationId`, `status`, `eventType`,
  `receivedAt`, and `processedAt`.
- `Customer`: `(organizationId, status, createdAt)` and
  `(organizationId, createdAt)` for list/cursor, `(organizationId, email)`
  for tenant-scoped search, unique `(id, organizationId)` for the mapping
  composite FK, unique `(organizationId, externalReference)`.
- `CustomerProviderMapping`: unique provider-identity and
  customer/provider-scope keys, plus `(organizationId, customerId)` and
  `(organizationId, provider, providerAccountScope)`.
- `Payment`: `(organizationId, createdAt)` for newest-first list,
  `(organizationId, status, createdAt)`,
  `(organizationId, customerId, createdAt)`,
  `(organizationId, currency, createdAt)`, unique `(id, organizationId)`.
- `Refund`: `(organizationId, createdAt)`,
  `(organizationId, paymentId, createdAt)`,
  `(organizationId, status, createdAt)`, unique `(id, organizationId)`.
- `IdempotencyRecord`: unique `(organizationId, scope, keyHash)` and
  unique `(scope, resourceId)`, plus
  `(organizationId, resourceType, resourceId)` and
  `(organizationId, status, updatedAt)`.
- `ProviderAccountConnection`: unique `(organizationId, provider)`,
  unique `(provider, providerAccountId)`, unique `(id, organizationId)`,
  plus `(organizationId, status)`.

## Database-enforced vs. application-enforced validation

Prisma and PostgreSQL cannot express every invariant this schema implies.

**Database-enforced today:**

- UUID primary keys and foreign key integrity.
- Uniqueness: `Organization.slug`, `User.email` (byte-for-byte
  `users_email_key`, plus case-insensitive `users_email_lower_uidx` on
  `LOWER(email)`),
  `(OrganizationMembership.organizationId, userId)`,
  `(ApiKey.organizationId, keyPrefix)`, `ApiKey.secretHash`,
  `Session.tokenHash`, `Session.createdBySessionId`,
  `UserCredential.userId`,
  `(InboxEvent.scopeKey, source, externalEventId)`,
  `(Customer.organizationId, externalReference)`,
  `(Customer.id, organizationId)`,
  mapping provider-identity and customer/provider-scope uniques.
- Outbox/inbox CHECK constraints in
  `add_transactional_outbox_and_inbox`: non-negative `attemptCount`,
  non-empty event/source identity, `PROCESSED` requires `processedAt`,
  outbox `PROCESSING` requires claim fields, inbox `scopeKey` is either
  `'platform'` (null organization) or the organization UUID text.
- Customer/mapping CHECKs in `add_customers_and_provider_mappings`:
  status/`archivedAt` consistency, non-empty optional text, object
  metadata, non-empty provider identity, and
  `providerAccountScope` alignment (`default` vs `acct:<id>`).
- Payment CHECKs in `add_payments`: positive requested amount, non-negative
  other amounts, amount inequalities, ISO currency shape, object metadata,
  FAILED/failure-field consistency, and SUCCEEDED-family captured amount.
- Refund CHECKs in `add_refunds`: positive amount, ISO currency shape,
  object metadata, and FAILED/failure-field consistency. Cross-row
  reservation (`SUM` of in-flight + succeeded refunds ≤ captured) is
  enforced in the application transaction that locks the parent payment.
- Idempotency CHECKs in `add_refunds`: SHA-256 hex for `key_hash` and
  `request_fingerprint`, non-empty `scope` and `resource_type`.
  `harden_financial_idempotency` adds lowercase-dot `scope` shape,
  lowercase `resource_type` shape, and the `idempotency_record_status`
  enum (`IN_PROGRESS`, `COMPLETED`).
- Provider-account CHECKs in `add_provider_account_connections`: provider
  shape, non-empty `provider_account_id`, and `ACTIVE` requires both
  capability booleans. No Stripe-named columns.
- Audit immutability in `enforce_immutable_audit_logs`:
  `BEFORE UPDATE OR DELETE` (and `BEFORE TRUNCATE`) raises
  `audit_logs is append-only`; CHECK constraints forbid both actor FKs,
  empty `action`/`resource_type`, and non-object `metadata`; actor FKs
  are `ON DELETE RESTRICT`. System actors (both FKs null) remain valid.
  Privileged roles can still drop or disable the trigger — this is not
  protection against a malicious PostgreSQL superuser.
- `NOT NULL` / nullability exactly as declared in the schema.
- Enum value membership (PostgreSQL enum types).
- `ON DELETE`/`ON UPDATE` behavior described above.

**Application-enforced, later (not yet implemented):**

- ISO 4217 currency code validation for `Organization.defaultCurrency`.
- ISO 3166-1 alpha-2 country code validation for `Organization.countryCode`.
- IANA timezone identifier validation for `Organization.timezone`.
- API-key scope vocabulary — `ApiKey.scopes` accepts arbitrary strings at
  the database level.
- API-key expiry/revocation consistency (for example, that `revokedAt` and
  `status: REVOKED` agree).
- Organization-owner business rules (for example, "an organization must
  have at least one `OWNER` membership") — not enforced by the schema.

None of the database-level constraints above are a substitute for these
checks; they exist to prevent structurally invalid data (duplicate keys,
dangling references), not to validate external standards.

### Canonical email uniqueness

Application write paths store `User.email` in canonical form: trim
surrounding whitespace and lowercase. They do **not** apply
provider-specific alias rules (Gmail dot-insensitivity, plus-address
rewriting) or extra Unicode normalization.

PostgreSQL additionally enforces that two emails differing only by case
cannot coexist, via `users_email_lower_uidx`:

```sql
CREATE UNIQUE INDEX "users_email_lower_uidx" ON "users" (LOWER("email"));
```

Direct database writes therefore cannot create `owner@example.com` and
`Owner@Example.com` as different users. The `enforce_canonical_email_uniqueness`
migration fails loudly if case-variant duplicates already exist; it never
merges accounts or deletes related rows. The Prisma `@unique` on `email`
is kept (not replaced) so the client can still look up the canonical
value by exact match.

## Security constraints

- **No raw card data.** Nothing in this schema stores payment card
  numbers or CVCs, and none will be added — see
  [ADR-005](../../docs/decisions/ADR-005-no-raw-card-data.md). Canonical
  `Payment` and `Refund` rows store minor-unit amounts and
  normalized failure fields only — never PAN, CVC, or provider payloads.
- **API keys:** `ApiKey.secretHash` stores only a cryptographic hash. The
  plaintext key is never persisted anywhere and is not recoverable from
  this database. `keyPrefix` is a non-secret identifier only.
- **Sessions:** `Session.tokenHash` stores only a hash of the session/
  refresh token. The plaintext token is never persisted. Access JWTs are
  never stored anywhere in this schema — they are stateless.
- **User credentials:** `UserCredential.passwordHash` stores only an
  Argon2id hash. The plaintext password is never persisted, logged, or
  recoverable from this database. See
  [`docs/architecture/authentication-and-access-control.md`](../../docs/architecture/authentication-and-access-control.md)
  for hashing parameters and the full authentication design.
- **Audit logs:** `AuditLog.metadata` must never contain secrets,
  plaintext credentials, session/API-key material, or raw card data.
  `AuditService` rejects forbidden keys/values so a surrounding
  transaction rolls back. Privileged database roles can still disable
  the append-only trigger — this is not protection against a malicious
  superuser. See
  [`docs/architecture/audit-logging.md`](../../docs/architecture/audit-logging.md).
- **Outbox / inbox:** `OutboxEvent.payload` and `metadata` must never
  contain secrets, tokens, provider credentials, or card data.
  `InboxEvent.payload` stores the verified inbound JSON object (Stripe
  webhook receipts included). It may contain provider PII; it must never
  contain PAN, CVC, secrets, or onboarding URLs. `lastErrorMessage`
  columns are bounded operational summaries, not stack traces. See
  [`docs/architecture/event-delivery.md`](../../docs/architecture/event-delivery.md)
  and
  [`docs/architecture/stripe-webhook-ingestion.md`](../../docs/architecture/stripe-webhook-ingestion.md).
- **No plaintext secrets, ever**, in this schema, its migrations, its
  seed data, or example `.env` values committed to this repository.

## Related decisions

- [ADR-002](../../docs/decisions/ADR-002-postgresql-and-prisma.md) —
  PostgreSQL and Prisma as the transactional datastore.
- [ADR-003](../../docs/decisions/ADR-003-multi-tenant-organization-model.md)
  — the tenancy model this schema implements.
- [ADR-007](../../docs/decisions/ADR-007-transactional-outbox-and-inbox.md)
  — transactional outbox and durable inbox; see
  [`docs/architecture/event-delivery.md`](../../docs/architecture/event-delivery.md).
- [ADR-005](../../docs/decisions/ADR-005-no-raw-card-data.md) — why this
  package will never contain card-data fields.
- [ADR-009](../../docs/decisions/ADR-009-integer-minor-units-for-money.md)
  and
  [ADR-010](../../docs/decisions/ADR-010-utc-time-and-iso-currencies.md) —
  binding for future money/ledger tables; this commit's timestamp columns
  (`@db.Timestamptz`) already follow ADR-010's UTC/timezone-aware
  requirement.
