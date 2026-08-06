# FraterUnion Payments — Security Boundaries

## Status

Authoritative. Defines binding security constraints for all implementation
work. Where this document and convenience conflict, this document wins.
This is an architecture-level threat model and boundary definition, not a
compliance certification of any kind — see the note at the end of this
document.

Last updated: 2026-08-06

## Card-data boundary

- FraterUnion Payments must never receive or store raw PAN (primary
  account number).
- FraterUnion Payments must never receive or store CVC.
- Browser and mobile clients must submit sensitive card data directly to
  provider-controlled SDKs or hosted elements (for example, Stripe.js,
  Stripe Elements, or a Stripe-hosted page) — never through a FraterUnion
  Payments API endpoint or a consumer product's own backend.
- Internal APIs receive only provider tokens, payment-method identifiers,
  or equivalent references. A payment method inside FraterUnion Payments
  is always a reference to something the provider holds, never the
  underlying card data.
- Logs must never contain sensitive payment credentials. This applies to
  application logs, error-tracking payloads, and any request/response
  logging performed by the API, worker, or Admin app.

Any code path that would cause raw PAN or CVC to reach a FraterUnion
Payments process, log, or data store is a critical defect, regardless of
how it was introduced.

## PCI scope strategy

FraterUnion Payments aims to minimize PCI DSS scope by relying on
provider-hosted or provider-tokenized collection for all sensitive card
data, so that FraterUnion systems only ever handle tokens and references.
This is a scope-reduction strategy, not a compliance claim: the project
must not claim a specific Self-Assessment Questionnaire (SAQ) classification,
or any other compliance status, until that classification has been
validated with qualified compliance/legal guidance. Engineering decisions
should be made to keep scope-reduction feasible, but formal PCI status is
outside engineering's authority to declare.

## Secret categories

The following secret categories require explicit, documented handling.
None of them may exist in plaintext in source control, ever — including in
example files, test fixtures, or commit history.

| Category                                       | Notes                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Application secrets (e.g. JWT signing keys)    | Encrypted at rest where retrieval is necessary for use; never logged.                                                 |
| API-key hashes                                 | Stored hashed, not encrypted-and-reversible; verification-only, so hashing (not encryption) is the correct primitive. |
| Provider credentials (e.g. Stripe secret keys) | Encrypted at rest; scoped per environment and, where the provider supports it, per tenant.                            |
| Webhook signing secrets                        | Encrypted at rest; used only to verify inbound webhook signatures.                                                    |
| Encryption keys                                | Managed through a secrets manager or KMS, not embedded in application config files.                                   |
| Database credentials                           | Environment-scoped, least-privilege, never shared between environments.                                               |
| Session secrets                                | Encrypted at rest where applicable; rotated on suspected compromise.                                                  |

General rules across all categories:

- **Never plaintext in source control.** `.env` files are gitignored (see
  the root [`.gitignore`](../../.gitignore)); only `.env.example` with
  placeholder values is committed.
- **Encryption where retrieval is necessary.** If the running system needs
  the original value back (for example, a provider API key used to call
  that provider), it is encrypted at rest, not hashed.
- **Hashing where verification-only is enough.** If the system only ever
  needs to confirm a presented value matches (for example, an API key
  presented by a caller), it is hashed, not stored reversibly.
- **Rotation.** All secret categories must be rotatable without downtime;
  rotation procedures are an operational requirement, not an afterthought.
- **Least privilege.** Credentials are scoped to the minimum access they
  require (a database role used by the API should not have superuser
  privileges; a provider API key should be scoped to what that integration
  needs).
- **Environment separation.** Secrets for development, staging, and
  production are distinct and never shared or copied between
  environments.
- **Audit of privileged operations.** Access to and use of secrets for
  privileged operations (for example, decrypting a provider credential, or
  issuing a manual refund) is auditable.

## Multi-tenancy boundary

- Every tenant-owned record must have explicit organization ownership
  (an organization identifier that is part of the record, not inferred).
- Tenant identity must come from authenticated context (the resolved
  identity of the API key, session, or service credential making the
  request), never from a value supplied in the request body or an
  unauthenticated header.
- Provider mappings (for example, FraterUnion customer → Stripe customer)
  must be organization-scoped, so that a mapping can never be looked up or
  reused across organizations.
- Cross-tenant resource identifiers must return safe failures. Requesting
  a resource that exists but belongs to a different organization must
  behave the same as requesting a resource that does not exist (typically
  a 404), never revealing that the resource exists elsewhere.
- Background jobs must carry and validate organization context. A worker
  processing a queued job must know which organization the job belongs to
  and must not be able to act across organizations implicitly.
- Tenant-isolation tests are mandatory for any endpoint or job that reads
  or writes tenant-owned data.

## Webhook boundary

- **Raw body preservation where required.** Signature verification for
  providers that sign the raw request body must operate on the exact bytes
  received, before any JSON parsing or transformation.
- **Signature verification before trusting content.** No webhook payload
  is processed, persisted as a decision-affecting event, or used to
  transition state before its signature has been verified.
- **Event persistence before processing.** Verified webhook events are
  durably persisted (inbox) before asynchronous processing begins, so that
  a crash between receipt and processing does not lose the event.
- **Deduplication.** Provider event identifiers are used to ensure the
  same event is never processed twice, even if delivered multiple times.
- **Replay handling.** Old, previously processed events replayed by a
  provider (or by an attacker who obtained a valid signed payload) must
  not cause duplicate state transitions or ledger entries.
- **Out-of-order handling.** Events are not guaranteed to arrive in the
  order they occurred; processing must tolerate a "later" event arriving
  before an "earlier" one for the same resource.
- **Unknown-event handling.** Event types the platform does not yet
  understand are persisted and safely ignored, not treated as errors that
  block processing of other events.
- **Secret rotation.** Webhook signing secrets can be rotated per provider
  account without downtime, including a transition period where both old
  and new secrets are accepted.
- **No trust based solely on source IP.** IP allow-listing, where used, is
  a defense-in-depth measure only; signature verification is the actual
  trust boundary and must never be skipped based on source IP.

## Administrative boundary

- **RBAC.** Administrative capabilities are gated by role, both at the
  platform-operator level (cross-tenant) and the tenant-administrator
  level (single-tenant).
- **Least privilege.** Administrative roles default to the minimum
  capability needed; broader roles (for example, one capable of issuing
  refunds) are assigned deliberately, not by default.
- **Strong authentication.** Administrative access requires strong
  authentication appropriate to the sensitivity of the capability.
- **Sensitive-action auditing.** Refunds, cancellations, provider
  reconnections, and similar sensitive actions are recorded in the audit
  log with the acting identity, target resource, and outcome.
- **Restricted refund/provider operations.** Issuing refunds and modifying
  provider connections are treated as sensitive operations subject to
  RBAC and auditing, not available to every administrative role by
  default.
- **No production secret display.** The Admin app never displays full
  provider credentials, webhook signing secrets, or other plaintext
  secrets, even to privileged operators; at most, masked or partial values
  are shown for identification purposes.
- **Potential step-up authentication for later phases.** Step-up
  authentication (for example, re-authentication or a second factor before
  a sensitive action) is a candidate control for later phases, not a v1
  commitment.

## Threat model summary

| Threat                                           | Mitigation                                                                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate charges                                | Idempotency keys on payment creation; provider-side idempotency where supported.                                                                                                                                 |
| Replay attacks                                   | Webhook signature verification plus event-id deduplication; idempotency keys on client-initiated requests.                                                                                                       |
| Forged webhooks                                  | Mandatory signature verification before any event is trusted or processed.                                                                                                                                       |
| Cross-tenant access                              | Organization-scoped queries everywhere; authenticated-context-derived tenant identity; isolation tests.                                                                                                          |
| Secret leakage                                   | Encryption/hashing per secret category; least privilege; no plaintext in source control or logs.                                                                                                                 |
| Privilege escalation                             | RBAC with least-privilege defaults; audited role and permission changes.                                                                                                                                         |
| Refund abuse                                     | RBAC-restricted refund operations; audit logging; maximum-refundable-amount checks (see [`payment-lifecycle.md`](./payment-lifecycle.md)).                                                                       |
| Log leakage                                      | No sensitive payment credentials, secrets, or raw card data in any log output; log redaction at the boundary.                                                                                                    |
| SQL injection                                    | Parameterized queries/ORM usage exclusively; no raw string-concatenated SQL.                                                                                                                                     |
| Dependency compromise                            | Dependency review and update process; minimal dependency footprint for code that touches money.                                                                                                                  |
| Worker duplication                               | Idempotent job processing; deduplication keyed by event/job identifier; safe-to-retry design.                                                                                                                    |
| Lost provider responses after successful charges | Reconciliation against provider data as the recovery mechanism, since webhooks and reconciliation — not the synchronous API response — are authoritative (see [`payment-lifecycle.md`](./payment-lifecycle.md)). |

## Compliance note

This document defines architectural intent and constraints. It is not a
compliance certification. FraterUnion Payments does not currently claim,
and must not be described as, PCI DSS compliant, SOC 2 compliant, or
certified under any other framework, until such status has been formally
assessed and validated by qualified, independent parties.

## Related decisions

- [ADR-003](../decisions/ADR-003-multi-tenant-organization-model.md) —
  the accepted tenancy model behind the multi-tenancy boundary above.
- [ADR-005](../decisions/ADR-005-no-raw-card-data.md) — the binding
  decision behind the card-data boundary above.
- [ADR-007](../decisions/ADR-007-transactional-outbox-and-inbox.md) — the
  inbox mechanism behind the webhook boundary above.
