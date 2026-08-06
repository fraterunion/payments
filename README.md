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

This repository currently contains **only the monorepo foundation**: the
workspace layout, shared tooling, and minimal, non-functional applications
and packages. No business logic, authentication, database schema, payment
provider integration, or webhook handling has been implemented yet. Treat
everything here as scaffolding for the commits that follow.

## Monorepo structure

```text
apps/
  api/      NestJS API (minimal, no business modules yet)
  admin/    Next.js App Router admin console
  docs/     Next.js App Router developer documentation site
  worker/   Standalone Node.js worker with graceful shutdown handling

packages/
  config/               Future environment/config utilities
  database/             Future Prisma schema (intentionally deferred)
  eslint-config/        Shared ESLint flat configs (base, next, node)
  payment-core/         Future provider-independent payment domain logic
  provider-contracts/   Future payment-provider interfaces
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

The worker process does not expose an HTTP port in this commit.

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
