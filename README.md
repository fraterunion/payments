# FraterUnion Payments

FraterUnion Payments is the centralized payments orchestration and billing
platform for the FraterUnion product family (GymOS, RestaurantOS, PlazaOS,
WristOS, UMA Temple of Beauty, SugarOS, and future products). It provides a
unified payments API, provider abstraction, customer and payment-method
tokenization, subscription billing, an internal financial ledger,
reconciliation, and normalized webhooks — without ever becoming a card
processor itself.

> **Security warning:** FraterUnion Payments must never receive, transmit,
> log or store raw card PAN or CVC data. Sensitive card collection must
> remain inside payment-provider-controlled components.

## Repository status

The monorepo foundation, core tenancy schema, authentication and
organization access control, immutable tenant audit logging, the
transactional outbox / durable inbox substrate, the provider-neutral
payment domain, and provider contracts/registry are in place. Payment
persistence, provider adapters, ledger posting, reconciliation, billing,
and outbound organization webhooks are not implemented yet.

## Monorepo structure

```text
apps/
  api/      NestJS API (auth and tenancy; no payment modules yet)
  admin/    Next.js App Router admin console
  docs/     Next.js App Router developer documentation site
  worker/   Outbox worker (PostgreSQL poll, claim, dispatch)

packages/
  config/               Shared environment/config utilities
  database/             PostgreSQL/Prisma schema and client
  events/               Transactional outbox and durable inbox
  eslint-config/        Shared ESLint flat configs (base, next, node)
  payment-core/         Provider-independent payment domain (money, states, refunds)
  provider-contracts/   Provider interface, capabilities, and registry
  sdk-typescript/       Future TypeScript SDK (@fraterunion-payments/sdk)
  shared/                Small shared utilities (e.g. assertNever)
  typescript-config/    Shared strict TypeScript configs
  ui/                   Future shared admin/docs React components

docs/            Architecture, decisions, operations, product, security notes
infrastructure/  Docker, Railway, and operational scripts (not yet populated)
```

## Documentation

Product scope and architectural principles are authoritative documents;
implementation must follow them, not the other way around.

**Product**

- [Vision](docs/product/vision.md) — mission, strategic problem, product
  principles, long-term direction, and non-goals.
- [V1 scope](docs/product/v1-scope.md) — the committed boundary for the
  first implementation milestone and its success criteria.

**Architecture**

- [System context](docs/architecture/system-context.md) — actors, system
  diagram, trust boundaries, deployment model, and architectural style.
- [Security boundaries](docs/architecture/security-boundaries.md) — the
  card-data boundary, secret handling, multi-tenancy, webhooks, and threat
  model.
- [Event delivery](docs/architecture/event-delivery.md) — transactional
  outbox, durable inbox, at-least-once semantics, and the outbox worker.
- [Audit logging](docs/architecture/audit-logging.md) — append-only,
  tenant-scoped security audit and how it differs from the outbox.
- [Payment domain](docs/architecture/payment-domain.md) — provider-neutral
  money, payment aggregate, and refund invariants.
- [Provider contracts](docs/architecture/provider-contracts.md) —
  provider interface, capabilities, registry, and normalized observations.
- [Payment lifecycle](docs/architecture/payment-lifecycle.md) — the
  normalized payment state machine and failure/refund handling.
- [Subscription lifecycle](docs/architecture/subscription-lifecycle.md) —
  design constraints for future recurring billing.
- [Ledger principles](docs/architecture/ledger-principles.md) — double-entry
  accounting principles, invariants, and reconciliation.

**Decisions**

- [Architecture Decision Records](docs/decisions/README.md) — the index of
  accepted decisions (framework choices, data store, tenancy, provider
  abstraction, card-data boundary, ledger model, event delivery, merchant
  accounts, and money/time representation) that implementation must follow.

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- pnpm 10+ (`corepack enable` recommended)

## Installation

```bash
pnpm install
```

## Development

```bash
pnpm dev         # run every app in watch/dev mode via Turborepo
pnpm build       # build every app and package
```

## Database

FraterUnion Payments uses PostgreSQL via Prisma
(see [ADR-002](docs/decisions/ADR-002-postgresql-and-prisma.md)). Schema,
migrations, and setup instructions live in
[`packages/database`](packages/database/README.md).

```bash
pnpm db:generate        # generate the Prisma client
pnpm db:validate        # validate the Prisma schema
pnpm db:migrate:dev     # create and apply a migration in development
pnpm db:migrate:deploy  # apply pending migrations (CI/production)
pnpm db:seed            # run the local development seed
pnpm db:studio          # open Prisma Studio
```

## API

The NestJS API's infrastructure (configuration, health checks, database
lifecycle, logging, error handling, authentication) is documented in
[`apps/api`](apps/api/README.md). The outbox worker is documented in
[`apps/worker`](apps/worker/README.md). Event APIs live in
[`packages/events`](packages/events/README.md).

```bash
pnpm dev:api                   # start the API in watch mode
pnpm build:api                 # build the API
pnpm start:api                 # run the built API
pnpm test:api                  # API unit tests
pnpm test:api:e2e              # API e2e tests (database dependency is faked)
pnpm test:api:integration:db   # real-PostgreSQL smoke test (requires DATABASE_URL)
```

## Quality commands

```bash
pnpm format        # format the repository with Prettier
pnpm format:check  # verify formatting without writing changes
pnpm lint          # lint every app and package
pnpm typecheck     # type-check every app and package
pnpm test          # run unit tests across the workspace
```

Commits are validated against [Conventional Commits](https://www.conventionalcommits.org/)
via commitlint, and a pre-commit hook runs Prettier/ESLint on staged files only.

## Application URLs (local development)

| App   | URL                   |
| ----- | --------------------- |
| API   | http://localhost:4000 |
| Admin | http://localhost:3000 |
| Docs  | http://localhost:3001 |

The worker process does not expose an HTTP port. It polls PostgreSQL
for outbox work; see [`apps/worker`](apps/worker/README.md).

## Contribution conventions

- Use Conventional Commits for every commit message (`feat:`, `fix:`, `chore:`, ...).
- Keep pull requests scoped to a single logical change.
- Run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`
  before opening a pull request; CI enforces the same checks.
- New packages/apps must reuse `@fraterunion-payments/eslint-config` and
  `@fraterunion-payments/typescript-config` rather than redefining lint or
  TypeScript rules locally.

## Security

**Raw card data must never enter FraterUnion Payments systems.** This
platform is a payments orchestrator, not a card processor: card capture,
tokenization, and PCI-scoped processing remain the responsibility of the
underlying payment providers (Stripe first, with additional providers such
as Helcim, Moneris, OpenPay, Conekta, Adyen, Mercado Pago, and Nuvei planned
for the future). FraterUnion Payments only ever handles provider-issued
tokens and references.
