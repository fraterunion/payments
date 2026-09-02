# FraterUnion Payments — Authentication and Access Control

## Status

Describes the authentication and organization-access-control system
implemented in `apps/api/src/auth` and `apps/api/src/audit`. Authoritative
for how this system behaves today; not a promise about future phases (see
[Deferred features](#deferred-features)).

Last updated: 2026-09-01

## Scope

This system implements:

- Human authentication: email + password, short-lived access JWTs, rotating
  opaque refresh/session tokens.
- Server-to-server authentication: organization-scoped API keys.
- Organization access control: an explicit, request-scoped tenant context,
  never trusted from client input (ADR-003).
- Role-based authorization for human principals; scope-based authorization
  for API-key principals.
- Audit logging of security-sensitive operations.

It does **not** implement provider accounts, Stripe integration, webhooks,
or ledger entries — those remain out of scope until their own commits.
Customers and canonical payments use this auth model. See
[Deferred features](#deferred-features) for security features explicitly
not yet implemented (MFA, password reset, and so on).

## Principals

A **principal** is the normalized, authenticated identity of whoever is
making a request. `apps/api/src/auth/types/principal.type.ts` defines it as
a discriminated union — never a single "user-shaped" object with optional
API-key fields:

```ts
type Principal =
  | { type: 'USER'; userId: string; sessionId: string; email: string }
  | {
      type: 'API_KEY';
      apiKeyId: string;
      organizationId: string;
      environment: ApiEnvironment;
      scopes: readonly string[];
    };
```

A human principal is authorized by **role**, resolved from their
organization membership. An API-key principal is authorized by **scopes**,
bound to it at creation time. These are deliberately different axes: a
human session's authority can span multiple organizations (one role per
membership); an API key is permanently bound to exactly one organization
and one `TEST`/`LIVE` environment.

## Human authentication

### Password storage

Argon2id via the `argon2` package (native binding, no custom crypto).
Parameters are explicit, never library defaults, and come from environment
configuration:

| Variable                      | Default | Meaning                      |
| ----------------------------- | ------- | ---------------------------- |
| `PASSWORD_ARGON2_MEMORY_KIB`  | `65536` | Memory cost, in KiB (64 MiB) |
| `PASSWORD_ARGON2_TIME_COST`   | `3`     | Iteration count              |
| `PASSWORD_ARGON2_PARALLELISM` | `1`     | Parallel lanes               |

`PasswordService` (`apps/api/src/auth/services/password.service.ts`)
centralizes hashing and verification:

- `hash()` / `verify()` are the only entry points; no call site touches
  `argon2` directly.
- `needsRehash()` supports detecting a stored hash whose parameters no
  longer match current configuration (checked, and acted on, at successful
  login — see [Login](#login)).
- `verifyDummy()` performs a real Argon2id verify against a fixed,
  never-matching hash, computed lazily using the process's actual
  configured cost parameters. Used whenever login must fail generically
  without a real credential to compare against, so response timing does
  not distinguish "unknown email" from "wrong password" (see
  [Login](#login)).
- As far as practical for a JS/native-addon boundary: verification time
  depends on the configured cost parameters, not on where a password first
  differs from the stored hash — Argon2 does not short-circuit on
  mismatch. This does not claim elimination of every timing side channel
  (network jitter, GC pauses, etc.), only that the comparison itself is
  not short-circuiting.

`UserCredential` (`packages/database/prisma/schema.prisma`) is a separate
model from `User` — one credential per user (`userId` unique), storing only
`passwordHash` and `passwordChangedAt`. No password history, no reset
tokens, no OAuth fields. Separating credentials from identity means a query
or response that returns `User` never has a hash sitting in the same row to
accidentally serialize.

### Password policy

Enforced primarily by `RegisterDto` (`class-validator`'s `@Length`), with
`PasswordService.validatePolicy()` as a second, service-layer check
(defense in depth against a future caller that bypasses the HTTP DTO):

- Minimum 12 characters, maximum 256.
- No composition rules — no mandatory uppercase, digits, or symbols.
  Passphrases are fully supported.
- No trimming, no other normalization. The exact bytes submitted are what
  get hashed.
- Registration errors are descriptive (`"Password must be at least 12
characters."`). **Login never runs this check** — `LoginDto` has no
  minimum-length validation at all, so a too-short password submitted at
  login fails through the normal generic-credential-failure path (see
  [Login](#login)) instead of a distinct validation error that would
  disclose the policy.

### Access JWTs

Issued and verified by `AccessTokenService`
(`apps/api/src/auth/services/access-token.service.ts`) via the
`jsonwebtoken` package (not `@nestjs/jwt`, to keep explicit, auditable
control over claims and algorithm allow-listing).

Claims: `sub` (user id), `sid` (the backing `Session.id`), `iat`, `exp`,
`iss`, `aud`, and `email`. No memberships, roles, or scopes are embedded —
a token never goes stale relative to a role change made after issuance,
because authorization is always re-resolved from the database on each
request (see [Organization context](#organization-context) and
[Roles](#roles-human-principals)).

| Variable                 | Default                    |
| ------------------------ | -------------------------- |
| `JWT_ACCESS_SECRET`      | _(required, no default)_   |
| `JWT_ACCESS_ISSUER`      | `fraterunion-payments`     |
| `JWT_ACCESS_AUDIENCE`    | `fraterunion-payments-api` |
| `JWT_ACCESS_TTL_SECONDS` | `900` (15 minutes)         |

Signing is **symmetric (HS256) for v1**. The algorithm, issuer, and
audience are pinned explicitly on both `sign` and `verify` — never left to
a token-supplied `alg` header or an unqualified `verify()` call — which is
what closes the classic "algorithm confusion" attack (a token signed with
`none` or a different algorithm is rejected; see
`access-token.service.spec.ts`). Moving to asymmetric (RS256/ES256)
signing later requires no change to any caller of `AccessTokenService`: the
service's public surface (`issue`/`verify`) is already the seam an
asymmetric implementation would sit behind. Symmetric signing was chosen
for v1 because this system has exactly one verifier (the API itself) — no
third party currently needs to verify a FraterUnion-issued access token
without holding the signing secret, which is the scenario asymmetric
signing exists to serve. **`JWT_ACCESS_SECRET` has no default and no dev
fallback** — it is a required environment variable in every environment,
and the schema enforces a 32-character minimum specifically in production
(see [Environment variables](#environment-variables)).

Access JWTs are **never stored** anywhere (no table, no cache). Validity is
purely cryptographic (`HumanJwtAuthGuard`) plus a check that the backing
session is still active (`ActiveSessionGuard`) — see
[Guards](#guards-and-request-pipeline).

### Sessions and refresh-token rotation

A `Session` row represents one link in a refresh-token rotation chain.
Only a SHA-256 hash of the opaque refresh token is stored
(`Session.tokenHash`, globally unique) — never the plaintext. No pepper is
used for this hash: the token is already 256 bits of server-generated
randomness (`crypto.randomBytes(32)`, base64url-encoded — see
`apps/api/src/auth/utils/crypto.util.ts`), so the hash exists for at-rest
hygiene (a leaked table doesn't hand out usable sessions), not to add
entropy a high-quality random token doesn't already have.

**Rotation model** (`SessionService.rotateSession`,
`apps/api/src/auth/services/session.service.ts`):

- `sessionFamilyId` is assigned at login (`@default(uuid(7))`) and carried
  unchanged by every rotation in that chain.
- `createdBySessionId` points at the session a given row's rotation
  replaced (`null` for the session created at login).
- Every successful refresh, in one transaction:
  1. Conditionally updates the presented session:
     `revokedAt = now(), rotatedAt = now(), lastUsedAt = now()`, but only
     `WHERE id = ? AND revokedAt IS NULL` — the `WHERE` clause is what
     makes the next step concurrency-safe (see below).
  2. If that update affected zero rows, someone else already
     rotated or revoked this exact session between this request's read and
     write — see **Concurrent rotation**, below.
  3. Otherwise, creates a new session row: same `sessionFamilyId`,
     `createdBySessionId` = the old row's id, and **`expiresAt` copied
     unchanged from the old row** — not recomputed from `now()`. This is
     what makes the family's lifetime absolute rather than a sliding
     window: no number of rotations can push the family's expiry past
     `now() + SESSION_TTL_SECONDS` measured from the _original_ login.
  4. Records `auth.session_refreshed` in the same transaction.
- `rotatedAt` and `revokedAt` are distinct fields with a specific meaning
  each: `revokedAt` means "no longer usable, for any reason" (logout,
  logout-all, rotation, reuse-detected family revocation — the general
  liveness check is always `revokedAt IS NULL AND expiresAt > now()`).
  `rotatedAt` means specifically "legitimately superseded by a rotation,"
  and is always set alongside `revokedAt` when that happens. This
  distinction is what reuse detection is built on.

**Reuse detection**: if a presented refresh token's hash matches a session
row where `rotatedAt IS NOT NULL`, that token has already been used once to
rotate — this is the signal a stolen-and-replayed refresh token produces.
`SessionService` responds by revoking **every** session in that
`sessionFamilyId` with `revokedAt IS NULL` in one statement, recording
`auth.refresh_reuse_detected`, and returning the same generic
"invalid refresh token" response as any other rejected refresh (never a
distinct "reuse detected" message to the caller). By contrast, presenting a
session that was revoked _without_ being rotated (an ordinary logout) is
rejected the same way but does **not** trigger a family-wide revocation —
that is not evidence of replay, just a stale client.

**Concurrent rotation**: two requests racing to rotate the _same_ token
both read the same not-yet-rotated session, but only one wins the
conditional `UPDATE ... WHERE revokedAt IS NULL` (step 1 above); the other
sees zero affected rows. Rather than treating the loser's failure as a
harmless "someone else already refreshed, please retry," this system
treats it identically to reuse detection: it revokes the entire family,
**including the session the winner just created moments earlier**. This is
a deliberate fail-closed choice — a genuine concurrent double-presentation
of one refresh token is not a normal client-retry pattern, and the safer
default is to force re-authentication for the whole chain rather than risk
leaving a session alive that a client didn't actually confirm receiving.
See `session.service.spec.ts`'s "treats a concurrent rotation race... as
reuse" test and `test/auth.integration-spec.ts`'s
"is safe under concurrent refresh" test for both the unit and real-Postgres
verification of this.

**Absolute session lifetime**: `SESSION_TTL_SECONDS` (default `2592000`,
30 days) bounds every session in a family from the original login, per the
inheritance rule above — there is no unlimited sliding-session mode. Access
tokens are short-lived (`JWT_ACCESS_TTL_SECONDS`, default 900 seconds); the
environment schema enforces `SESSION_TTL_SECONDS > JWT_ACCESS_TTL_SECONDS`
so a configuration cannot accidentally make sessions shorter-lived than the
access tokens issued from them.

`Session.lastUsedAt` is updated on the _old_ row at the moment of a
successful rotation (not on every access-JWT-authenticated request, which
would mean a database write on every single API call for a field that's
purely diagnostic).

### Registration

`POST /api/v1/auth/register` — `AuthService.register`
(`apps/api/src/auth/services/auth.service.ts`). One database transaction
creates, in order: the organization (`type: BUSINESS`, `status: ACTIVE`),
the user (`status: ACTIVE`), the credential, an `OWNER` membership, and the
first session — plus the `auth.registered` audit record, all committed or
rolled back together. There is no way to request `type: INTERNAL` or a
starting role other than `OWNER` through this endpoint.

- **Email uniqueness is global, checked inside the transaction**: a
  duplicate email is rejected outright (`409 Conflict`) — this commit does
  not silently attach a new registration to an existing account (that
  belongs to a future invitations feature).
- **Organization slug uniqueness** is checked the same way.
- A residual race (two registrations for the same email/slug committing
  concurrently) is caught by the database's own unique constraints and
  translated to the same generic `409`.
- Password hashing happens **before** the transaction opens (Argon2 is
  CPU-bound; holding a database transaction open for the duration of a
  hash would needlessly extend lock/connection hold time).

### Login

`POST /api/v1/auth/login` — always responds with the same generic
`"Invalid email or password."` (`401`) for: an unknown email, a user with
no credential (should not occur in this commit's flows, but defensively
handled), a suspended user, and a wrong password. **All four paths perform
a real Argon2id verify** — either against the actual stored hash, or (for
the first three) against `PasswordService.verifyDummy()` — so response
timing does not distinguish "this account doesn't exist" from "this
account exists but you have the wrong password." No account-lockout
mechanism exists in this commit (see [Deferred features](#deferred-features)).

On success: creates a session, issues an access token, updates
`User.lastLoginAt`, and records `auth.login_succeeded`. If the stored
credential's Argon2id parameters no longer match current configuration
(`PasswordService.needsRehash`), the password is re-hashed with current
parameters and persisted in the same request — this is the only
credential-mutation path outside registration.

**Failed logins are not audited.** `AuditLog.organizationId` is required,
and a failed login has no reliably-correct organization to attribute it
to. Rather than guess or attach it to an arbitrary organization, failed
login attempts are simply not recorded in `AuditLog` in this commit — see
[Audit logging](#audit-logging) for the full policy and why the same
constraint means most session-lifecycle audit records use a "sole
membership" lookup rather than a truly independent organization signal.

### Refresh, logout, logout-all, me

- `POST /api/v1/auth/refresh` — delegates entirely to
  `SessionService.rotateSession`; see
  [Sessions and refresh-token rotation](#sessions-and-refresh-token-rotation).
- `POST /api/v1/auth/logout` — requires a valid access JWT
  (`HumanJwtAuthGuard` + `ActiveSessionGuard`); revokes the session named by
  the JWT's `sid` claim. **Idempotent at the service layer**
  (`SessionService.revokeSession` is safe to call twice — a second call
  affects zero rows and records no duplicate audit entry), but a repeat
  HTTP call with the _same_ token cannot actually reach that idempotent
  path: once a session is revoked, `ActiveSessionGuard` rejects the token
  with `401` before the request reaches `AuthService.logout` at all — see
  [Active-session enforcement](#active-session-enforcement-not-just-jwt-validity).
  This is correct, not a gap: the guard rejecting a stale token is the same
  behavior every other protected route exhibits, and it is exactly what
  "revoked sessions reject even with an unexpired JWT" requires.
- `POST /api/v1/auth/logout-all` — revokes every active session for the
  user (`SessionService.revokeAllSessions`), audited with the count of
  sessions actually revoked. The access JWT used to call this route may
  remain cryptographically valid until its own `exp`, but every session it
  or any other token was backed by is now revoked, so every subsequent
  request rejects at `ActiveSessionGuard`.
- `GET /api/v1/auth/me` — returns the user's safe identity fields
  (`id`, `email`, `displayName`, `status`, `createdAt`), every organization
  membership (`organizationId`, `organizationName`, `organizationSlug`,
  `role`), and the current session's `id`/`expiresAt`. Never returns
  credential material — `User` has none itself (see
  [Password storage](#password-storage)), and the query behind `/me` never
  even selects `UserCredential`.

## Organization context

**Never trusted from client input as authority by itself** (ADR-003) — a
human's `x-organization-id` header must resolve to an existing, active
membership; an API key's organization is never taken from a header at all,
only from the key's own bound `organizationId`.

`OrganizationContextGuard`
(`apps/api/src/auth/guards/organization-context.guard.ts`) resolves and
attaches `request.organizationContext: { organizationId, role? }`:

- **Human principal**: reads `x-organization-id`, validates it is a
  syntactically well-formed UUID, looks up the membership
  (`organizationId_userId` composite key) **joined with the organization's
  status**, and rejects (`403`) if either the membership doesn't exist or
  the organization is not `ACTIVE`. Both failure cases return the
  identical response — the guard never confirms or denies whether an
  organization id exists, which is what keeps cross-tenant probing from
  learning anything. (This deliberately uses `403 Forbidden` rather than
  `404 Not Found` for this specific case: `x-organization-id` selects
  context via a header, not a URL-addressed resource, so a `404` would be
  a category mismatch. Resource lookups scoped by organization — none
  exist yet in this commit — should still follow
  [`security-boundaries.md`](./security-boundaries.md)'s guidance to
  return `404` for a cross-tenant id.)
- **API-key principal**: the organization is always the key's own bound
  `organizationId`; any `x-organization-id` header present on the request
  is ignored entirely. Only the organization's `ACTIVE` status is checked.
- **Routes with no org context yet** (`register`, `login`, `refresh`) do
  not run this guard and do not require the header — there is no
  authenticated principal yet at that point in the flow.

`role` on `OrganizationContext` is present only for human principals (their
resolved membership role); absent for API-key principals, which are
authorized by scope instead (see [Roles](#roles-human-principals) and
[Scopes](#scopes-api-key-principals)).

## Roles (human principals)

Five roles, defined in `packages/database/prisma/schema.prisma`'s
`MembershipRole` enum: `OWNER`, `ADMIN`, `DEVELOPER`, `ANALYST`, `SUPPORT`.

`@RequireRoles(...)` (`apps/api/src/auth/decorators/require-roles.decorator.ts`)
declares an explicit, closed set of permitted roles per route —
deliberately no numeric hierarchy (`OWNER > ADMIN > ...`) to reason about;
a route lists exactly the roles allowed to call it.
`RequireRolesGuard` checks the resolved `request.organizationContext.role`
against that set — **never** a role supplied by the client. Because role
is re-resolved from the database on every request (via
`OrganizationContextGuard`, not decoded from the JWT), a role change takes
effect on a user's very next request, with no need to wait for their
access token to expire — verified directly in
`test/auth.integration-spec.ts`'s "re-resolves role from the database on
every request" test, which demotes a live member mid-session and confirms
the very next request is rejected.

## Scopes (API-key principals)

`API_KEY_SCOPES` (`apps/api/src/common/constants/api-key-scopes.constants.ts`)
is the complete, closed vocabulary an API key can be assigned:
`organizations:read`, `api_keys:read`, `api_keys:write`,
`customers:read`, `customers:write`, `payments:read`, `payments:write`.
New scopes are added only when the resource they guard actually exists.
See [`customers.md`](./customers.md) and
[`payments-persistence.md`](./payments-persistence.md) for RBAC.

`@RequireScopes(...)` + `RequireScopesGuard` enforce that an `API_KEY`
principal holds every listed scope. The guard is a **no-op for `USER`
principals** — humans are governed by role, not scope — which is what lets
the same decorator guard `GET /auth/context` (usable by either principal
type) without a human caller needing any scope at all.

## API keys

### Format

```text
fup_test_<prefix>_<secret>
fup_live_<prefix>_<secret>
```

(`apps/api/src/auth/utils/api-key-format.util.ts`)

- `fup` — static, non-secret product marker.
- `test`/`live` — mirrors `ApiEnvironment`; visible so a key's environment
  is identifiable without a database lookup, and so a `TEST` key pasted
  somewhere is recognizably safe.
- `<prefix>` — 12 lowercase hex characters (48 bits), stored in
  `ApiKey.keyPrefix` purely for dashboard/log identification. **It is not
  a lookup key** — see below.
- `<secret>` — a 256-bit random value, base64url-encoded
  (`generateOpaqueToken()`, the same primitive session tokens use). Never
  stored; only its hash is.
- The prefix is fixed-length and hex (never contains `_`), so parsing does
  not rely on the secret being free of `_` — base64url legitimately
  contains it.

### Hashing and lookup

`ApiKey.secretHash` is `HMAC-SHA256(secret, API_KEY_HASH_SECRET)` — keyed
with a pepper, unlike session tokens' unkeyed hash, specifically because
`API_KEY_HASH_SECRET` is one of the environment's required secrets and the
task this system was built against calls for it explicitly.

**Deliberate deviation from a "look up by prefix, then verify hash"
design**: because this hash is deterministic (not a per-row-salted,
memory-hard hash like Argon2id), `ApiKeyService.authenticate` computes the
hash of the _presented_ secret and looks up the `ApiKey` row directly by
`secretHash` (globally unique) — the same direct-hash-lookup pattern this
schema already uses for `Session.tokenHash`. This is strictly better than
prefix-based lookup-then-verify: it's a single indexed equality lookup, and
`keyPrefix`'s uniqueness is only scoped to `(organizationId, keyPrefix)`
in the schema (not global), so a prefix-based lookup would need to handle
multiple candidate rows across organizations. `keyPrefix` remains exactly
what its schema comment says: a non-secret display identifier, never a
lookup key.

Authentication (`ApiKeyAuthGuard` + `ApiKeyService.authenticate`) rejects,
with the identical generic `"Invalid API key."` message, for: a malformed
key (parsed before any database query), an unknown hash, a `REVOKED` key, an
expired key, and a key whose organization is not `ACTIVE`. `lastUsedAt` is
updated best-effort, fire-and-forget, after a successful authentication —
a failure to write it never fails the request it happened alongside
(`api-key.service.spec.ts` verifies this directly).

### Header

`x-api-key`, chosen explicitly over reusing `Authorization: Bearer` to
avoid any ambiguity between a human JWT and a server API key sharing one
header/scheme.

### Management routes

`POST /api/v1/api-keys`, `GET /api/v1/api-keys`,
`POST /api/v1/api-keys/:id/revoke` (`apps/api/src/auth/api-keys.controller.ts`)
— all require a **human** JWT, resolved organization context, and a role
in `OWNER | ADMIN | DEVELOPER` (`ANALYST`/`SUPPORT` cannot reach this
controller at all). Managing API keys is itself a human, role-gated
action: an API key can authenticate itself for scoped resource access, but
it cannot create, list, or revoke other API keys.

**`DEVELOPER` may only create or revoke `TEST`-environment keys** — a
documented policy choice enforced in the controller (checked against
`organizationContext.role` for create, and against the target key's own
`environment` for revoke), not a schema constraint. `OWNER`/`ADMIN` have no
such restriction.

- **Create**: validates `scopes` against the closed `API_KEY_SCOPES`
  catalog (`CreateApiKeyDto`'s `@IsIn`), generates the key with up to 5
  collision-retry attempts on a `P2002` unique-constraint error (astronomically
  unlikely at 48+256 bits of combined randomness, but handled rather than
  assumed away), persists only prefix + hash, and returns the full
  plaintext key **exactly once**, audited (`api_key.created`) atomically
  with the row creation.
- **List**: returns only safe metadata (`id`, `name`, `keyPrefix`,
  `status`, `environment`, `scopes`, `lastUsedAt`, `expiresAt`,
  `revokedAt`, `createdAt`) — never `secretHash`, never a recovered key.
- **Revoke**: sets `status: REVOKED` and `revokedAt`, never deletes,
  idempotent (a second revoke of an already-revoked key is a no-op, not an
  error), audited (`api_key.revoked`) atomically with the update.
  **Scoped to the caller's own organization** — attempting to revoke
  another organization's key id returns the identical `204` a real
  same-organization revoke would, and leaves the other organization's key
  untouched; this is the same "cross-tenant existence must never be
  confirmable" property `OrganizationContextGuard` follows, applied to a
  resource id instead of a header (verified in
  `test/auth.integration-spec.ts`'s "cross-org revoke attempt is a safe
  no-op" test).

## Guards and request pipeline

Composed in this order for every protected route: **authentication →
active-session enforcement → organization context → role/scope policy →
controller.** Each concern is its own guard, composed via `@UseGuards(...)`
rather than one large guard, so each is independently unit-testable (see
`apps/api/src/auth/guards/*.spec.ts`):

| Guard                      | Responsibility                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `HumanJwtAuthGuard`        | Verifies the access JWT (signature, issuer, audience, algorithm, expiry); attaches a `USER` principal.          |
| `ApiKeyAuthGuard`          | Verifies an `x-api-key` header via `ApiKeyService`; attaches an `API_KEY` principal.                            |
| `EitherAuthGuard`          | For the one route usable by either principal type (`GET /auth/context`); dispatches on which header is present. |
| `ActiveSessionGuard`       | For `USER` principals, confirms the backing `Session` is still active; a no-op for `API_KEY` principals.        |
| `OrganizationContextGuard` | Resolves and attaches `request.organizationContext` — see [Organization context](#organization-context).        |
| `RequireRolesGuard`        | Enforces `@RequireRoles(...)` against the resolved role.                                                        |
| `RequireScopesGuard`       | Enforces `@RequireScopes(...)` against an `API_KEY` principal's scopes; a no-op for `USER` principals.          |

### Active-session enforcement, not just JWT validity

A cryptographically valid, unexpired access JWT is **not** sufficient to
authenticate a request. `ActiveSessionGuard` performs a database check
(`SessionService.isSessionActive`, keyed by the JWT's `sid` claim) on every
request from a `USER` principal, and rejects if the backing session has
been revoked (by logout, logout-all, rotation, or reuse-detected family
revocation) or has expired. This is what makes logout, logout-all, and
reuse-detected revocation take effect immediately, rather than waiting up
to `JWT_ACCESS_TTL_SECONDS` for the token itself to expire.

### `@CurrentPrincipal()` / `@CurrentOrganizationContext()`

Typed param decorators
(`apps/api/src/auth/decorators/current-principal.decorator.ts`,
`current-organization-context.decorator.ts`) read `request.principal` /
`request.organizationContext`, attached by the guards above, following the
same `createParamDecorator` pattern as the existing `@RequestId()`
decorator.

### The diagnostic `GET /auth/context` route

Returns only `{ principalType, organizationId, role?, environment?,
scopes? }` — no secrets, no business data. Exists specifically so both
principal types and the full guard chain (`EitherAuthGuard` →
`ActiveSessionGuard` → `OrganizationContextGuard` → `RequireScopesGuard`)
have one real, exercised route to run through end-to-end; it is
deliberately not a stand-in for any actual business endpoint. Gated with
`@RequireScopes('organizations:read')`, which — per
[Scopes](#scopes-api-key-principals) — only constrains `API_KEY` callers;
a human caller needs no scope, only a resolved organization membership.

## Audit logging

`AuditService.write` (`apps/api/src/audit/audit.service.ts`) is
append-only: every call is an `INSERT`. PostgreSQL rejects `UPDATE` and
`DELETE` on `audit_logs`. Every event requires an explicit
`organizationId` — there is no "log without a tenant" path. Actors are
`USER` / `API_KEY` / `SYSTEM`. See
[`audit-logging.md`](./audit-logging.md).

**Minimum action vocabulary this commit records** (`AUDIT_ACTIONS`,
`apps/api/src/audit/audit.types.ts`): `auth.registered`,
`auth.login_succeeded`, `auth.session_refreshed`, `auth.session_revoked`,
`auth.all_sessions_revoked`, `auth.refresh_reuse_detected`,
`api_key.created`, `api_key.revoked`.

**Atomicity**: `AuditService.write(client, input)` always uses the
supplied Prisma client or transaction. It never opens a nested
transaction. Every mutation that must be atomic with its audit record
(registration; refresh rotation; API-key create/revoke) passes that
transaction's client through, so both commit or roll back together.
Forbidden audit metadata rejects the write and therefore the
transaction. Nothing in this service catches and discards a failure.

**What is _not_ audited, and why**:

- **Failed logins.** A failed login (unknown email, wrong password,
  suspended user) has no organization that can be attributed to it without
  guessing. Rather than attach it to an arbitrary or looked-up
  organization, failed logins are simply not recorded in `AuditLog` in
  this commit.
- **Session-lifecycle events use a "sole membership" resolution, which can
  itself skip the audit write.** `auth.login_succeeded`,
  `auth.session_refreshed`, `auth.session_revoked`,
  `auth.all_sessions_revoked`, and `auth.refresh_reuse_detected` are
  user-scoped events, not inherently organization-scoped — a `User` can in
  principle belong to zero, one, or many organizations. This commit has no
  invitation feature, so in practice every registered user has **exactly
  one** membership (the one created at their own registration), and that
  organization is used for these audit records
  (`OrganizationMembershipService.findSoleMembership`). If a user's
  membership count is ever not exactly one — only reachable after a future
  multi-org/invitations feature — the audit write is skipped rather than
  guessed at, and a warning is logged. **This is a known, deliberate
  limitation to revisit when invitations are implemented**, not an
  oversight.

**What must never appear in audit metadata**: passwords, password hashes,
JWTs, refresh tokens, API-key secrets or hashes, cookies, or raw
`Authorization`/`x-api-key` header values. Callers construct only safe
objects; `AuditService` then rejects forbidden keys or values so a
surrounding transaction rolls back. Every call site in this codebase
passes only non-secret identifiers (e.g. `keyPrefix`, `environment`,
`role`, counts). `test/auth.integration-spec.ts` spot-checks persisted
rows after a representative set of operations. See
[`audit-logging.md`](./audit-logging.md).

## Token and key storage summary

| What                    | Stored as                                                  | Recoverable?     |
| ----------------------- | ---------------------------------------------------------- | ---------------- |
| Password                | Argon2id hash (`UserCredential.passwordHash`)              | No               |
| Access JWT              | Not stored at all (stateless)                              | N/A              |
| Session / refresh token | SHA-256 hash (`Session.tokenHash`)                         | No               |
| API-key secret          | HMAC-SHA256 w/ `API_KEY_HASH_SECRET` (`ApiKey.secretHash`) | No               |
| API-key prefix          | Plaintext (`ApiKey.keyPrefix`) — non-secret by design      | N/A (not secret) |

## Environment variables

All validated by `apps/api/src/config/environment.schema.ts` (Zod);
invalid or missing configuration fails startup immediately, before Nest's
container is even created, with a message that names the field but never
echoes a secret's value.

| Variable                      | Required | Default                    | Notes                                                                        |
| ----------------------------- | -------- | -------------------------- | ---------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`           | **yes**  | —                          | ≥32 characters enforced in production; must not equal `API_KEY_HASH_SECRET`. |
| `JWT_ACCESS_ISSUER`           | no       | `fraterunion-payments`     |                                                                              |
| `JWT_ACCESS_AUDIENCE`         | no       | `fraterunion-payments-api` |                                                                              |
| `JWT_ACCESS_TTL_SECONDS`      | no       | `900`                      | 60–3600                                                                      |
| `SESSION_TTL_SECONDS`         | no       | `2592000` (30 days)        | 60–31536000; must exceed `JWT_ACCESS_TTL_SECONDS`.                           |
| `PASSWORD_ARGON2_MEMORY_KIB`  | no       | `65536`                    | 8192–1048576                                                                 |
| `PASSWORD_ARGON2_TIME_COST`   | no       | `3`                        | 1–10                                                                         |
| `PASSWORD_ARGON2_PARALLELISM` | no       | `1`                        | 1–16                                                                         |
| `API_KEY_HASH_SECRET`         | **yes**  | —                          | Same production-length rule as `JWT_ACCESS_SECRET`; must not equal it.       |
| `AUTH_COOKIE_ENABLED`         | no       | `false`                    | See [Cookies](#cookies).                                                     |
| `AUTH_COOKIE_SECURE`          | no       | `false`                    | Required `true` when `AUTH_COOKIE_ENABLED=true` in production.               |
| `AUTH_COOKIE_SAME_SITE`       | no       | `lax`                      | `lax`\|`strict`\|`none`; `none` requires `AUTH_COOKIE_SECURE=true`.          |

`JWT_ACCESS_SECRET` and `API_KEY_HASH_SECRET` are never reused for one
another, enforced by a `superRefine` cross-field check — and neither is
ever reused for a future webhook-signing secret, which must be its own,
independent value when that feature is built.

## Cookies

**This commit's primary and only contract is JSON over the `Authorization`
header (JWT) and `x-api-key` header** — no request in this system reads or
writes a cookie. The `AUTH_COOKIE_*` environment variables exist and are
validated (coherence between `enabled`/`secure`/`sameSite` is enforced;
see [Environment variables](#environment-variables)) specifically so a
future cookie-based transport (for browser clients that want an HttpOnly
refresh-token cookie) has its configuration surface already defined and
tested, without this commit taking on the added complexity of actual
cookie issuance, CORS-credentials wiring, and CSRF design that a real
cookie transport requires. This is a deliberate scope decision, not an
oversight: validating configuration now, and deferring transport, avoids
half-implementing a security-sensitive feature under time pressure.

## Normalization and validation

- **Email**: trimmed and lowercased by the shared
  `canonicalizeEmail` helper (`apps/api/src/auth/utils/canonicalize-email.util.ts`),
  applied via `class-transformer`'s `@Transform` on both `RegisterDto` and
  `LoginDto` before `class-validator`'s `@IsEmail` runs. No
  provider-specific canonicalization (for example, Gmail's
  dot-insensitivity or plus-alias rewriting) — two emails differing only
  by dots or `+tags` are treated as distinct. Login looks up the
  already-canonical value; it does not use `LOWER(email)` as the normal
  query path. **PostgreSQL additionally enforces case-insensitive
  uniqueness** with the functional unique index `users_email_lower_uidx`
  (`CREATE UNIQUE INDEX ... ON users (LOWER(email))`), so a direct
  database write cannot create `owner@example.com` and `Owner@Example.com`
  as different identities. Prisma cannot declare expression indexes in
  `schema.prisma`; that index lives only in the
  `enforce_canonical_email_uniqueness` migration. The Prisma `@unique` on
  `User.email` is retained so `findUnique` / `upsert` still resolve by the
  canonical value the application always writes. A case-only duplicate
  registration is rejected with the same generic `409` as an exact
  duplicate — never with index names, Prisma codes, or SQL fragments.
- **Organization slug**: trimmed, lowercased, `^[a-z0-9]+(-[a-z0-9]+)*$`,
  3–63 characters.
- **Currency / country / timezone**: `class-validator`'s built-in
  `@IsISO4217CurrencyCode`, `@IsISO31661Alpha2`, and `@IsTimeZone`
  decorators (backed by the already-present `validator` package, a
  transitive dependency of `class-validator`) — no new dependency was
  added, and no hand-maintained code list needs to track ISO revisions.
- **UUIDs** (`x-organization-id`, API-key path params): validated before
  use — a malformed header is rejected the same as a missing one; a
  malformed path param is rejected by `ParseUUIDPipe`.
- **API-key names, scopes, TTLs**: `CreateApiKeyDto` — name length-bounded,
  scopes checked against the closed catalog, `expiresAt` ISO-8601.
- **Refresh tokens**: length-bounded (`RefreshDto`, max 512 characters) so
  an oversized payload is rejected by validation before any hashing work.
- **Passwords**: length-bounded only (12–256); see
  [Password policy](#password-policy) for why no composition rules exist.

Mass-assignment protection is inherited from the application-wide
`ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true` — see
`apps/api/README.md`) — every auth DTO benefits from it with no
route-specific code.

## Known limitations and deferred features

Explicitly out of scope for this commit:

- Multi-factor authentication (MFA/2FA).
- Password reset / forgot-password flow.
- Email verification (the schema has `emailVerifiedAt`, but nothing sets
  it yet).
- Social login / OAuth provider integrations.
- Organization invitations (inviting an existing or new user to an
  additional organization) — this is _why_ registration rejects a
  duplicate email outright instead of attaching to an existing account,
  and why session-lifecycle audit records assume exactly one membership
  per user (see [Audit logging](#audit-logging)).
- SSO.
- Account lockout / brute-force throttling on login.
- Rate limiting of any kind.
- Redis-backed or otherwise cached session storage — sessions are read
  from PostgreSQL directly on every check.
- Global platform-admin impersonation or any cross-tenant support-access
  flow.
- Actual cookie-based token transport (see [Cookies](#cookies) — the
  configuration surface exists, the transport does not).
- Payment-related API-key scopes (reserved conceptually, not present in
  `API_KEY_SCOPES` — see [Scopes](#scopes-api-key-principals)).

## Related decisions

- [ADR-003](../decisions/ADR-003-multi-tenant-organization-model.md) — the
  tenancy model [Organization context](#organization-context) implements:
  explicit `organizationId` ownership, tenant identity from authenticated
  context only.
- [`security-boundaries.md`](./security-boundaries.md) — the multi-tenancy
  and secret-handling boundaries this system is built to satisfy;
  see [Environment variables](#environment-variables) for how the secret
  categories it defines (application secrets, API-key hashes, session
  secrets) map onto this system's concrete configuration.

No new ADR was added for this commit: every design choice here (rotation
model, HS256-for-v1, `x-api-key` header, HMAC-SHA256 for API-key hashing)
is an implementation detail within the boundaries ADR-003 and
`security-boundaries.md` already establish, not a new architectural
decision those documents don't already govern.
