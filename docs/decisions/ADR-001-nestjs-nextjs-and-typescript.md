# ADR-001: NestJS, Next.js and TypeScript

## Status

Accepted

Last updated: 2026-08-06

## Context

FraterUnion Payments needs an API framework, an admin/documentation
frontend stack, and a worker runtime, chosen once for the whole monorepo
rather than per-application. FraterUnion already operates
TypeScript/Next.js/NestJS systems elsewhere, so this choice affects
available engineering capacity, not just a single project. The platform
also depends heavily on sharing types and small packages (normalized
states, provider contracts, SDK types) between the API, worker, and admin
app, which favors one language across the stack. Team velocity and
maintainability on a financial platform matter more here than language
novelty or theoretical best-fit-per-component.

## Decision

- NestJS is the framework for the API.
- Next.js App Router is the framework for the admin and documentation
  applications.
- The worker is a standalone TypeScript Node.js process (no application
  framework).
- TypeScript is used across the entire repository — application code,
  packages, and configuration.
- TypeScript strict mode (plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, and
  `useUnknownInCatchVariables`) is mandatory everywhere.
- The repository is organized as a Turborepo-managed pnpm workspace monorepo.

## Consequences

### Positive

- One language and largely one tooling chain (TypeScript, ESLint,
  Prettier, Vitest/Jest) across API, worker, admin, docs, and shared
  packages.
- Types for normalized payment/subscription/ledger state, provider
  contracts, and the SDK can be shared as workspace packages instead of
  duplicated or reconstructed per application.
- Matches existing FraterUnion engineering expertise, reducing onboarding
  and hiring friction.
- NestJS's module system gives the API explicit internal boundaries
  (customers, payments, ledger, webhooks) without requiring separate
  services.

### Negative

- The entire platform's reliability is coupled to the Node.js runtime and
  its ecosystem's characteristics (single-threaded event loop, garbage
  collection pauses, npm supply-chain surface).
- NestJS and Next.js each bring their own conventions and upgrade
  cadences that the project must track.
- TypeScript's type system does not, by itself, prevent runtime data
  errors; discipline is still required at I/O boundaries.

### Risks and mitigations

- **Domain logic becoming coupled to NestJS.** Mitigated by ADR-004's
  requirement that core/domain packages stay framework-neutral (see
  [Implementation implications](#implementation-implications)).
- **Node.js runtime limits under high load.** Mitigated by keeping the
  worker process separate from the API (see
  [`../architecture/system-context.md`](../architecture/system-context.md#architectural-style)),
  so CPU- or I/O-bound asynchronous work does not degrade API latency; if
  Node.js characteristics prove insufficient for a specific hot path,
  that is an implementation-level optimization, not necessarily a reason
  to change the platform language.

## Alternatives considered

- **Go** — strong operational characteristics, but would fragment the
  stack from the rest of FraterUnion's TypeScript systems and lose type
  sharing with admin/docs/SDK.
- **Java/Kotlin** — mature for financial systems, but heavier operational
  footprint and a larger departure from current team expertise than
  justified at this stage.
- **Python** — familiar in some contexts, but weaker end-to-end static
  typing story for a codebase that shares types across API, worker,
  admin, and a public SDK.
- **Separate repositories per application** — rejected in favor of a
  monorepo so that shared packages (domain, provider contracts, SDK,
  config) stay in lockstep instead of being versioned and published
  independently at this stage.
- **Express/Fastify without NestJS** — more minimal, but would require
  rebuilding module boundaries, dependency injection, and testing
  conventions that NestJS already provides and that a payments platform
  benefits from having enforced by the framework.
- **A React SPA without Next.js** — would require separately building
  routing, server-side concerns, and deployment tooling that Next.js App
  Router already provides for the admin and docs applications.

## Implementation implications

- Domain packages (for example, a future `@fraterunion-payments/payment-core`)
  must not depend on NestJS; they must be usable from the worker or a
  future different API framework without modification.
- Provider contracts (`@fraterunion-payments/provider-contracts`) must
  remain framework-neutral for the same reason.
- Worker logic should reuse domain packages rather than reimplementing
  payment or ledger logic against its own types.
- Application boundaries between `apps/api`, `apps/worker`, `apps/admin`,
  and `apps/docs` must remain explicit; shared logic belongs in
  `packages/`, not copy-pasted across apps.
- Strict TypeScript settings are enforced repository-wide via
  `@fraterunion-payments/typescript-config`; loosening them for
  convenience in a specific package or app is not acceptable without a
  new ADR.

## Revisit conditions

- NestJS, Next.js, or Node.js itself prove structurally unable to meet a
  concrete operational requirement (for example, sustained latency or
  throughput targets that the runtime cannot meet even after
  optimization).
- A specific, high-value component (for example, a computationally
  intensive reconciliation or fraud-signal process) demonstrates a clear,
  measured need for a different runtime, considered as a targeted
  addition rather than a wholesale migration.
