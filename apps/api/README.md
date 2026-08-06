# @fraterunion-payments/api

## Purpose

The NestJS API is the FraterUnion Payments HTTP surface. This commit
establishes production-ready API _infrastructure_ only: typed configuration,
health checks, database lifecycle, structured logging, request correlation,
global validation and error handling, versioning, and Swagger — no business
domain (customers, payments, auth) exists yet. See
[ADR-001](../../docs/decisions/ADR-001-nestjs-nextjs-and-typescript.md) for
why NestJS was chosen, and
[`../../docs/architecture/security-boundaries.md`](../../docs/architecture/security-boundaries.md)
for the secret-handling rules this app follows.

## Module structure

```text
src/
├── app.module.ts        AppModule.forRoot(environment) — wires every module below
├── app.setup.ts          configureApp() — helmet, CORS, prefix/versioning, validation, Swagger
├── main.ts               bootstrap: load env, create app, configureApp, shutdown handlers, listen
├── common/
│   ├── constants/         service identifiers, error codes, request-id format
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

## Swagger

- UI: `GET /docs`
- JSON: `GET /docs-json`
- Controlled by `SWAGGER_ENABLED`; both routes return `404` when disabled.
- Documents a Bearer (`bearer`) and an API-key (`x-api-key`) auth scheme as
  reserved contract definitions for future use — **no guard currently
  enforces either**; nothing is actually protected yet.
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
  future audit-logging and domain code.

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
`CONFLICT`, `DEPENDENCY_UNAVAILABLE` (reserved for future use), `INTERNAL_ERROR`.
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
- Redacted regardless: `authorization`, `cookie`, `x-api-key` headers,
  `set-cookie` response header, and any `password`, `secret`, `token`,
  `apiKey`, `databaseUrl`, `cardNumber`, or `cvc` field found in a logged
  object, at any depth.
- No remote log transport is configured.

## Validation

A global `ValidationPipe` (`createValidationPipe()`) is configured with
`transform: true`, `whitelist: true`, `forbidNonWhitelisted: true`, and a
custom `exceptionFactory` that throws `ValidationException` (carrying
structured `{ field, message }[]` details) instead of NestJS's default
shape — so `GlobalExceptionFilter` handles it like any other `AppException`,
with no format-sniffing. No business DTOs exist yet;
[`src/common/pipes/validation-pipe.factory.spec.ts`](./src/common/pipes/validation-pipe.factory.spec.ts)
proves the configuration itself works, using a fixture DTO local to that
test file only.

## Testing

```bash
pnpm test:api               # unit tests (src/**/*.spec.ts) — no database required
pnpm test:api:e2e           # e2e tests (test/*.e2e-spec.ts) — DatabaseService is faked
pnpm test:api:integration:db  # real PostgreSQL smoke test — requires DATABASE_URL
```

- **Unit tests** cover environment validation (valid config, missing/invalid
  `DATABASE_URL`, invalid port, invalid boolean, production wildcard CORS
  rejection, origin-list parsing, secrets never appearing in error
  messages), request-ID resolution, `GlobalExceptionFilter`'s envelope for
  every case above, `HealthService` against a controlled fake
  `DatabaseService`, and the validation pipe fixture.
- **e2e tests** (`test/app.e2e-spec.ts`) boot the real `AppModule` through
  the real `configureApp()` setup with `DatabaseService` swapped for
  `test/support/fake-database.service.ts` — so they exercise actual
  middleware, filters, and HTTP configuration without needing PostgreSQL.
  Cover: `/api/v1`, `/health/live`, `/health/ready` (both outcomes),
  `/unknown-route`, request-ID behavior, security headers, CORS
  allow/deny, and the Swagger on/off toggle.
- **`test:integration:db`** (`test/database.integration-spec.ts`) boots the
  app with the _real_ `DatabaseService` against `DATABASE_URL` and asserts
  `/health/ready` returns `200`. Skips (does not fail) when `DATABASE_URL`
  is unset, so it never blocks a developer without PostgreSQL configured;
  it is a distinct script, never part of `pnpm test`.

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
