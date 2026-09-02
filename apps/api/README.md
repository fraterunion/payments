# @fraterunion-payments/api

## Purpose

The NestJS API is the FraterUnion Payments HTTP surface. It provides
production-ready API infrastructure (typed configuration, health checks,
database lifecycle, structured logging, request correlation, global
validation and error handling, versioning, Swagger) and, as of the `auth`,
`customers`, `payments`, `refunds`, and `provider-connections` modules,
human authentication, organization-scoped API keys, role/scope-based access
control, tenant-safe customers, canonical payment/refund create/get/list
(internal lifecycle only; public APIs still do not execute on Stripe),
Stripe connected-account onboarding behind canonical provider-connection
resources, and durable Stripe webhook ingestion (signature verify → inbox
receipt only; no payment-domain normalization yet). Billing remains out of
scope. See
[ADR-001](../../docs/decisions/ADR-001-nestjs-nextjs-and-typescript.md) for
why NestJS was chosen,
[`../../docs/architecture/security-boundaries.md`](../../docs/architecture/security-boundaries.md)
for the secret-handling rules this app follows, and
[`../../docs/architecture/authentication-and-access-control.md`](../../docs/architecture/authentication-and-access-control.md)
for the full authentication and access-control design.

## Module structure

```text
src/
├── app.module.ts        AppModule.forRoot(environment) — wires every module below
├── app.setup.ts          configureApp() — helmet, CORS, prefix/versioning, validation, Swagger
├── main.ts               bootstrap: load env, create app, configureApp, shutdown handlers, listen
├── common/
│   ├── constants/         service identifiers, error codes, request-id format, API-key scope catalog
│   ├── decorators/        @RequestId() param decorator
│   ├── exceptions/        AppException, ValidationException (+ class-validator → ErrorDetail[] mapping)
│   ├── filters/           GlobalExceptionFilter
│   ├── middleware/        requestIdMiddleware (+ standalone resolveRequestId())
│   ├── pipes/              createValidationPipe() factory
│   └── types/              RequestWithId, ErrorEnvelope
├── config/
│   ├── app-config.module.ts    AppConfigModule.forRoot(environment) — global, DI-only
│   ├── app-config.service.ts   typed getters over the frozen Environment
│   ├── environment.schema.ts   Zod schema + loadEnvironment()
│   ├── environment.types.ts    Environment interface + DI token
│   └── logger.options.ts       nestjs-pino options derived from Environment
├── database/
│   ├── database.module.ts      not global — only imported where DatabaseService is needed
│   ├── database.service.ts     owns the Prisma client's connect/disconnect lifecycle
│   └── database.types.ts
├── audit/                       AuditService.write/list — append-only, tenant-scoped (not global; no public CRUD)
├── idempotency/                  Financial-command idempotency (no public HTTP)
├── customers/                    Customer CRUD/archive, provider-mapping service (create is service-only)
├── payments/                     Canonical payment create/get/list; internal lifecycle; create idempotency
├── provider-connections/         Canonical Stripe Connect onboarding; human OWNER/ADMIN create
├── webhooks/                     POST /webhooks/stripe — signature verify + InboxEvent receipt
├── auth/                         see below and
│   │                             ../../docs/architecture/authentication-and-access-control.md
│   ├── auth.module.ts
│   ├── auth.controller.ts        POST /auth/register, /login, /refresh, /logout, /logout-all; GET /auth/me, /auth/context
│   ├── api-keys.controller.ts    POST/GET /api-keys, POST /api-keys/:id/revoke
│   ├── services/                  PasswordService, AccessTokenService, SessionService, ApiKeyService, AuthService, OrganizationMembershipService
│   ├── guards/                    HumanJwtAuthGuard, ApiKeyAuthGuard, EitherAuthGuard, ActiveSessionGuard, OrganizationContextGuard, RequireRolesGuard, RequireScopesGuard
│   ├── decorators/                @CurrentPrincipal(), @CurrentOrganizationContext(), @RequireRoles(...), @RequireScopes(...)
│   ├── dto/                       RegisterDto, LoginDto, RefreshDto, CreateApiKeyDto, response DTOs
│   ├── types/                     Principal, OrganizationContext, AuthenticatedRequest, request-context, JWT payload
│   └── utils/                     crypto.util (opaque tokens, hashing), api-key-format.util, request-context.util, prisma-error.util
├── health/                     GET /health/live, GET /health/ready
└── root/                       GET /api/v1
```

`common/interceptors` was not created: nothing in this commit needs one
(request logging is handled by `nestjs-pino`'s own HTTP middleware, not a
Nest interceptor).

## Environment variables

Validated by [`src/config/environment.schema.ts`](./src/config/environment.schema.ts)
using Zod. Parsing happens once, at the very start of `main.ts`'s
`bootstrap()`, before Nest's container is even created — an invalid value
fails startup immediately with a readable, field-by-field message and never
echoes the invalid value itself (so a malformed `DATABASE_URL` can't leak
credentials into a log line).

| Variable              | Required | Default                 | Notes                                                          |
| --------------------- | -------- | ----------------------- | -------------------------------------------------------------- |
| `NODE_ENV`            | no       | `development`           | `development` \| `test` \| `production`                        |
| `API_PORT`            | no       | `4000`                  | 1–65535                                                        |
| `API_HOST`            | no       | `0.0.0.0`               | non-empty                                                      |
| `API_PREFIX`          | no       | `api`                   | leading/trailing slashes stripped                              |
| `API_VERSION`         | no       | `1`                     | positive integer; becomes the URI version segment (`v1`)       |
| `DATABASE_URL`        | **yes**  | —                       | must start with `postgresql://` or `postgres://`               |
| `LOG_LEVEL`           | no       | `info`                  | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`             |
| `CORS_ORIGINS`        | no       | `http://localhost:3000` | comma-separated; **no `*` allowed when `NODE_ENV=production`** |
| `SWAGGER_ENABLED`     | no       | `true`                  | `true`/`false` only — not coerced from other truthy strings    |
| `TRUST_PROXY`         | no       | `false`                 | `true`/`false` only                                            |
| `SHUTDOWN_TIMEOUT_MS` | no       | `10000`                 | positive, capped at 120000                                     |

Authentication-specific variables (`JWT_ACCESS_*`, `SESSION_TTL_SECONDS`,
`PASSWORD_ARGON2_*`, `API_KEY_HASH_SECRET`, `AUTH_COOKIE_*`) are documented
in full — including their production-only constraints and cross-field
rules — in
[`../../docs/architecture/authentication-and-access-control.md#environment-variables`](../../docs/architecture/authentication-and-access-control.md#environment-variables)
rather than duplicated here.

When `STRIPE_ENABLED=true`, the API also requires `STRIPE_SECRET_KEY`,
`STRIPE_CONNECT_RETURN_URL`, and `STRIPE_CONNECT_REFRESH_URL`. Those
values are never logged or returned. See
[`../../docs/architecture/stripe-connect.md`](../../docs/architecture/stripe-connect.md).

Optional `STRIPE_WEBHOOK_SECRET` (`whsec_…`) enables
`POST /api/v1/webhooks/stripe`. `STRIPE_WEBHOOK_SECRET_PREVIOUS` is the
retiring secret during rotation. Neither is logged, returned, audited, or
shown in Swagger. See
[`../../docs/architecture/stripe-webhook-ingestion.md`](../../docs/architecture/stripe-webhook-ingestion.md).

Configuration is exposed only through `AppConfigService`'s typed getters —
nothing reads `process.env` outside `main.ts`'s single `loadEnvironment()`
call. `AppConfigService.databaseUrl` has no corresponding HTTP-exposed
field anywhere; it is never returned in a response.

## Local startup

```bash
# from the repository root
cp .env.example .env   # then fill in a real DATABASE_URL
pnpm db:migrate:dev     # if you haven't already (see packages/database/README.md)
pnpm dev:api
```

`apps/api` reads its environment the normal Node.js way (the process
environment); populate it however you prefer (a `.env` loaded by your shell,
export statements, etc.). Nothing in this app auto-loads a `.env` file
itself.

## Health endpoints

```http
GET /health/live
GET /health/ready
```

Deliberately outside `/api/v1` and excluded from the global prefix.
Liveness never touches the database — only readiness does, via
`SELECT 1` through Prisma. A failed readiness check returns `503` with
`dependencies.database: "down"` and never leaks the underlying database
error; the internal error is logged server-side with the request ID
instead. See
[`src/health/health.service.ts`](./src/health/health.service.ts).

## Root endpoint

```http
GET /api/v1
```

Confirms the versioned API is reachable. Not a health check — it does not
query the database.

## Authentication and API keys

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout          (requires human JWT)
POST /api/v1/auth/logout-all      (requires human JWT)
GET  /api/v1/auth/me              (requires human JWT)
GET  /api/v1/auth/context         (requires human JWT or x-api-key; diagnostic only)

POST /api/v1/api-keys             (requires human JWT + x-organization-id + OWNER/ADMIN/DEVELOPER)
GET  /api/v1/api-keys             (requires human JWT + x-organization-id + OWNER/ADMIN/DEVELOPER)
POST /api/v1/api-keys/:id/revoke  (requires human JWT + x-organization-id + OWNER/ADMIN/DEVELOPER)
```

Human authentication is email + password (Argon2id) with a short-lived
access JWT (`Authorization: Bearer <token>`) and a rotating opaque refresh
token. Server-to-server callers authenticate with an organization-scoped
API key (`x-api-key: fup_test_...` / `fup_live_...`) instead. Organization
context for a human request is resolved from an `x-organization-id` header
against an active membership — never trusted from the header alone (see
ADR-003) — while an API key is always bound to its own organization. Full
design, including refresh-token rotation and reuse detection, the
role/scope authorization model, and audit logging, is documented in
[`../../docs/architecture/authentication-and-access-control.md`](../../docs/architecture/authentication-and-access-control.md).

## Payments

```http
POST /api/v1/payments            (Idempotency-Key required; OWNER/ADMIN/DEVELOPER or payments:write)
GET  /api/v1/payments            (OWNER/ADMIN/DEVELOPER/ANALYST/SUPPORT or payments:read)
GET  /api/v1/payments/:paymentId
```

Creates a canonical FraterUnion Payments payment in `CREATED`. Amount is
integer minor units as a decimal string (`"12500"`). Provider execution
and public lifecycle mutation endpoints are intentionally absent. See
[`../../docs/architecture/payments-persistence.md`](../../docs/architecture/payments-persistence.md).

## Refunds

```http
POST /api/v1/payments/:paymentId/refunds   (Idempotency-Key required; OWNER/ADMIN/DEVELOPER or refunds:write)
GET  /api/v1/payments/:paymentId/refunds   (OWNER/ADMIN/DEVELOPER/ANALYST/SUPPORT or refunds:read)
GET  /api/v1/refunds
GET  /api/v1/refunds/:refundId
```

Creates a canonical FraterUnion Payments refund in `CREATED`. Amount is
integer minor units as a decimal string (`"5000"`). Currency is taken
from the payment. `CREATED` reserves capacity; it does not mean money
moved externally. Public lifecycle mutation endpoints are intentionally
absent. See [`../../docs/architecture/refunds.md`](../../docs/architecture/refunds.md).

## Stripe webhooks

```http
POST /api/v1/webhooks/stripe
```

Unauthenticated by JWT/API key. Authenticated only by Stripe signature
verification over the exact raw body. Returns `{ "received": true }`.
Does not mutate Payment, Refund, ledger, or audit. See
[`../../docs/architecture/stripe-webhook-ingestion.md`](../../docs/architecture/stripe-webhook-ingestion.md).

## Financial idempotency

`POST /payments` and nested refund create require `Idempotency-Key`. There
is no public idempotency management API and no authorize/capture/cancel
or refund-execute endpoint. See
[`../../docs/architecture/idempotency.md`](../../docs/architecture/idempotency.md).

## Swagger

- UI: `GET /docs`
- JSON: `GET /docs-json`
- Controlled by `SWAGGER_ENABLED`; both routes return `404` when disabled.
- Documents a Bearer (`bearer`) and an API-key (`x-api-key`) auth scheme,
  both enforced for real by `auth`'s guards — see
  [`../../docs/architecture/authentication-and-access-control.md`](../../docs/architecture/authentication-and-access-control.md).
- Swagger's own routes are mounted directly on the HTTP adapter and are
  unaffected by `API_PREFIX`/versioning.

## Database lifecycle

`DatabaseService` (in `src/database/`) owns the
[`@fraterunion-payments/database`](../../packages/database/README.md)
Prisma client for the whole process:

- Built via composition (`createPrismaClient()`), not by subclassing the
  generated `PrismaClient` — the driver-adapter constructor requirement
  Prisma 7 imposes is exactly the kind of detail this service exists to
  keep out of every consumer.
- The client is constructed in `DatabaseService`'s constructor, but
  **construction never connects** — connecting only happens explicitly in
  `onModuleInit()`, and disconnecting in `onModuleDestroy()`. Importing
  `@fraterunion-payments/database` anywhere never opens a connection by
  itself.
- `onModuleInit()` calls `$connect()` **and then runs `SELECT 1`**. Prisma
  7's driver-adapter `$connect()` alone does not eagerly validate
  connectivity — the underlying pool connects lazily, per query — so a
  real query is required to actually prove the database is reachable at
  startup, bounded by `createPrismaClient`'s `connectionTimeoutMillis`
  (see [`packages/database/README.md`](../../packages/database/README.md)).
- If the initial connection fails, Nest's bootstrap (`app.init()` /
  `NestFactory.create()`) rejects and `main.ts`'s `bootstrap()` fails with
  a non-zero exit — the API does not start half-broken.
- `DatabaseModule` is **not global**: only `HealthModule` imports it in
  this commit. Nest still resolves `DatabaseService` as a single shared
  instance regardless of how many modules import `DatabaseModule`.
- No retry loop exists yet; a database outage after startup surfaces as a
  failing readiness check, not a crash loop.

## Request IDs

- Incoming `x-request-id` is accepted only if it is 1–128 characters of
  letters, numbers, dashes, underscores, or periods
  (`src/common/constants/request-id.constants.ts`); anything else —
  missing, too long, or containing disallowed/control characters — is
  replaced with a generated UUID (`node:crypto`'s `randomUUID()`; no extra
  dependency).
- Set by `requestIdMiddleware`, registered via `app.use()` in
  `configureApp()` — deliberately _not_ Nest's `MiddlewareConsumer`, so it
  also runs for requests matching no controller at all (e.g. `404`s).
- Always present on the response as `x-request-id`, and always present in
  `error.requestId` on every error envelope.
- Available to controllers via the `@RequestId()` param decorator, for
  audit writes and domain code.

## Error envelope

Every error response — validation failures, NestJS `HttpException`s,
unmatched routes, and unexpected errors — is normalized by
`GlobalExceptionFilter` into:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [{ "field": "email", "message": "email must be an email" }],
    "requestId": "..."
  }
}
```

`details` is only present when there is field-level information to give
(currently: validation failures). Stable codes:
`VALIDATION_ERROR`, `NOT_FOUND`, `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`,
`CONFLICT`, payment/customer-specific codes (`PAYMENT_NOT_FOUND`,
`IDEMPOTENCY_KEY_CONFLICT`, …), `DEPENDENCY_UNAVAILABLE` (reserved for
future use), `INTERNAL_ERROR`.
Every `5xx` response uses the fixed message `"An unexpected error occurred."`
— never a raw error message, database error, or stack trace; the real
error and stack are logged server-side with the request ID instead.

## Logging and redaction

Structured logging via `nestjs-pino`/`pino`
(`src/config/logger.options.ts`):

- Pretty, colorized output outside production; structured JSON in
  production. Silent during tests (`NODE_ENV=test`) unless a test asserts
  on log output directly.
- Every request log line includes the request ID, method, path, and status
  code via `pino-http`'s HTTP logger.
- `req`/`res` are re-serialized narrowly (method, url, id / statusCode
  only) — full headers and bodies are never logged by default.
- Redacted regardless: `authorization`, `cookie`, `x-api-key`,
  `stripe-signature` headers, `req.rawBody`, `set-cookie` response header,
  and any `password`, `passwordHash`, `secret`, `secretHash`, `token`,
  `accessToken`, `refreshToken`, `apiKey`, `rawKey`, `jwtAccessSecret`,
  `apiKeyHashSecret`, `stripeWebhookSecret`, `stripeWebhookSecretPrevious`,
  `webhookSecret`, `databaseUrl`, `cardNumber`, or `cvc` field found in a
  logged object, at any depth. This is defense in depth on top of `req`/`res`
  re-serialization already excluding bodies — no code in `auth`/`audit`
  deliberately logs a raw request body or DTO, but the redact list guards
  against that changing by accident.
- No remote log transport is configured.

## Validation

A global `ValidationPipe` (`createValidationPipe()`) is configured with
`transform: true`, `whitelist: true`, `forbidNonWhitelisted: true`, and a
custom `exceptionFactory` that throws `ValidationException` (carrying
structured `{ field, message }[]` details) instead of NestJS's default
shape — so `GlobalExceptionFilter` handles it like any other `AppException`,
with no format-sniffing.
[`src/common/pipes/validation-pipe.factory.spec.ts`](./src/common/pipes/validation-pipe.factory.spec.ts)
proves the configuration itself works, using a fixture DTO local to that
test file; `src/auth/dto/` (`RegisterDto`, `LoginDto`, `RefreshDto`,
`CreateApiKeyDto`) are the first real business DTOs exercising it in
production — email/ISO-code/timezone validation, password length policy,
and the closed API-key-scope catalog are all enforced here, before any
request reaches a controller.

## Testing

```bash
pnpm test:api                  # unit tests (src/**/*.spec.ts) — no database required
pnpm test:api:e2e              # e2e tests (test/*.e2e-spec.ts) — DatabaseService is faked
pnpm test:api:integration:db   # real PostgreSQL smoke test — requires DATABASE_URL
pnpm test:api:auth             # unit tests scoped to src/auth — no database required
pnpm test:api:auth:integration # real PostgreSQL auth suite — requires DATABASE_URL
# Stripe webhook HTTP e2e: test/webhooks.e2e-spec.ts (signature failures
# run with FakeDatabaseService; persistence requires DATABASE_URL)
# Stripe webhook real-PG concurrency / no-mutation:
#   test/webhooks.integration-spec.ts
#   pnpm --filter @fraterunion-payments/api run test:webhooks:integration
# Audit immutability / query tests live in test/audit.integration-spec.ts
# and run with the same jest-integration config as auth integration.
# Payment real-PG tests: test/payments.integration-spec.ts
# Payment HTTP e2e: test/payments.e2e-spec.ts
```

- **Unit tests** cover environment validation (valid config, missing/invalid
  `DATABASE_URL`, invalid port, invalid boolean, production wildcard CORS
  rejection, origin-list parsing, secrets never appearing in error
  messages), request-ID resolution, `GlobalExceptionFilter`'s envelope for
  every case above, `HealthService` against a controlled fake
  `DatabaseService`, the validation pipe fixture, and — under `src/auth/`
  and `src/audit/` — every auth service and guard against fakes/mocks
  (password hashing and policy, JWT issue/verify including algorithm- and
  claim-tampering rejection, opaque-token and API-key-format utilities,
  session rotation/reuse-detection/concurrency-race handling,
  API-key generation/hashing/lookup, all seven guards, and `AuthService`'s
  orchestration of register/login/refresh/logout/me/context).
- **e2e tests** (`test/app.e2e-spec.ts`, `test/auth.e2e-spec.ts`) boot the
  real `AppModule` through the real `configureApp()` setup with
  `DatabaseService` swapped for `test/support/fake-database.service.ts` —
  so they exercise actual middleware, filters, and HTTP configuration
  without needing PostgreSQL. `app.e2e-spec.ts` covers `/api/v1`,
  `/health/live`, `/health/ready` (both outcomes), `/unknown-route`,
  request-ID behavior, security headers, CORS allow/deny, and the Swagger
  on/off toggle. `auth.e2e-spec.ts` covers only what can be verified
  without a database: DTO validation (invalid email, weak password,
  invalid ISO codes, malformed slug, mass-assignment rejection) and every
  authentication guard's rejection path for a missing/malformed
  credential — every other auth route requires real persisted state to
  exercise meaningfully, which is why full auth-flow coverage lives in the
  real-Postgres suite below instead of a second, heavily-mocked e2e file.
- **`test:integration:db`** (`test/database.integration-spec.ts`) boots the
  app with the _real_ `DatabaseService` against `DATABASE_URL` and asserts
  `/health/ready` returns `200`. Skips (does not fail) when `DATABASE_URL`
  is unset, so it never blocks a developer without PostgreSQL configured;
  it is a distinct script, never part of `pnpm test`.
- **`test:api:auth:integration`** (`test/auth.integration-spec.ts`) is the
  authoritative correctness suite for authentication: it boots the app
  against a real, migrated PostgreSQL database (same skip-when-unset
  behavior as above) and exercises the full HTTP surface plus direct
  database inspection — registration atomicity, email/slug uniqueness and
  canonicalization, login, refresh rotation, reuse detection (including a
  genuine concurrent-refresh race), logout/logout-all, `/me`,
  cross-organization isolation, role re-resolution on every request,
  API-key creation/authentication/listing/revocation (including the
  `DEVELOPER`-cannot-create-`LIVE`-keys policy and cross-org revoke
  safety), audit-record persistence, and a direct check that no plaintext
  password, refresh token, or API-key secret is ever persisted anywhere.
  Test data uses the reserved `fup-test-` slug prefix and `@fup.test`
  email domain. `afterAll` always closes the Nest app, even if cleanup
  throws. The shared helper deletes tracked IDs, historical `cust-`
  leftovers, and namespace rows older than one hour — never the live
  fixtures of a parallel Jest worker. Delete order is RESTRICT-safe:
  mappings, refunds, payments, idempotency records, customers, outbox/inbox, API keys, audit (user triggers
  disabled only for that delete; production code never does this),
  users, then organizations. Seed `fraterunion` /
  `@fraterunion.local` is never removed. See
  [`docs/architecture/audit-logging.md`](../../docs/architecture/audit-logging.md)
  and `packages/database/README.md`. There is no public `GET /audit`
  route; `AuditService.list` is service-only.

## Graceful shutdown

`main.ts` registers its own `SIGTERM`/`SIGINT` handlers (rather than
`app.enableShutdownHooks()`, to get a bounded timeout) that call
`app.close()` — which runs `DatabaseService.onModuleDestroy()` and every
other provider's shutdown hook — racing it against `SHUTDOWN_TIMEOUT_MS`;
exceeding the timeout force-exits with a logged error. A clean shutdown
exits `0`; a failed one exits `1`. Startup failures (invalid config, a
database that never connects) set `process.exitCode = 1` in the top-level
`bootstrap().catch()` rather than starting in a half-working state.
`process.exit()` is only ever called from this single top-level handler,
never from inside a service.
