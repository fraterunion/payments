# Financial-operation idempotency

Authoritative description of FraterUnion Payments API / financial-command
idempotency. Implemented in `apps/api/src/idempotency` with persistence on
`idempotency_records`. This is not provider-operation idempotency and not
a public management API.

Last updated: 2026-09-02

## Two layers

```text
Client
  |
  | Idempotency-Key
  v
FUP command identity
  (organization + scope + key hash)
  |
  | operationId  (idempotency_records.id)
  v
Canonical financial operation
  |
  | deterministic ProviderIdempotencyKey   ← future
  v
Provider adapter                           ← future
```

The client header identifies a **logical FUP command**. It is hashed, never
stored, never logged, never audited, and never forwarded to a provider.

A future adapter derives `ProviderIdempotencyKey` from the durable FUP
`operationId` (`idempotency_records.id`). Same FUP operation → same provider
key. Different provider or operation → different key.

Do not conflate:

```text
FUP API / financial-command idempotency
  ≠
provider-operation idempotency
```

## Scope

Scopes are a closed, provider-neutral registry. Lowercase dot notation,
non-empty, no control characters, no user-defined namespaces.

Callable today:

```text
payment.create
refund.create
```

Reserved for future provider orchestration (not publicly callable):

```text
payment.authorize
payment.capture
payment.cancel
refund.execute
```

There are no Stripe-specific scopes and no `GET`/`POST /idempotency`
endpoints. There are no public authorize, capture, cancel, or refund-execute
HTTP routes in this commit.

## Durable model

```text
idempotency_records
  id                  UUIDv7 = FUP operation identity
  organizationId
  scope
  keyHash             SHA-256 of the trimmed Idempotency-Key
  requestFingerprint  SHA-256 of canonical command JSON
  resourceType        payment | refund
  resourceId          durable subject/result UUID
  status              IN_PROGRESS | COMPLETED
  createdAt
  updatedAt
```

Unique:

```text
(organizationId, scope, keyHash)
(scope, resourceId)
```

`resourceType` / `resourceId` is the durable **subject or result** identity.
It does not claim this row created the resource:

- `payment.create` / `refund.create` bind the created aggregate.
- Future `payment.capture` binds the existing Payment being captured.

HTTP response bodies are not stored.

## Key hashing

`Idempotency-Key` is required on payment and refund create. Surrounding
whitespace is trimmed because that behavior already shipped; `"abc"` and
`" abc "` hash as the same key. Keys are otherwise opaque: empty, oversized
(>255), and control-character values are rejected rather than rewritten.

The raw value is never persisted, logged, returned, or written to audit.

## Canonical fingerprinting

Fingerprint material is domain-separated:

```text
scope
organizationId
semantic request
```

Canonical JSON:

- object keys sorted recursively
- arrays keep semantic order (not globally sorted)
- bigint as decimal string
- `null` is distinct from a missing field when the command includes `null`
- SHA-256 of `JSON.stringify`

`undefined`, functions, symbols, `NaN`, `Infinity`, and non-plain objects
throw rather than producing a surprising digest.

Payment create semantic fields (byte-compatible with records stored before
this commit):

```text
customerId
requestedAmount
currency
captureMethod
description
metadata
```

Refund create:

```text
paymentId
amount
reason
metadata
```

Same body under `payment.capture` versus `refund.create` cannot collide:
`scope` is part of the digest even though uniqueness already includes scope.

## Replay-first semantics

```text
1. find existing (organization, scope, keyHash)
2. same fingerprint + COMPLETED → replay bound resource
3. same fingerprint + IN_PROGRESS → 409 IDEMPOTENCY_OPERATION_IN_PROGRESS
4. different fingerprint → 409 IDEMPOTENCY_KEY_CONFLICT
5. only if no binding exists → evaluate current business eligibility
```

A capture that already completed must replay even if today's Payment state
would reject a new capture. Refund create replays before capacity checks.

Conflict responses do not leak fingerprints, hashes, or stored request
bodies.

## Concurrency

PostgreSQL unique `(organizationId, scope, keyHash)` is the reservation
lock. Concurrent identical commands: one insert wins; the loser rolls back,
loads the winner, and replays. Concurrent same key / different fingerprint:
one owner, others `IDEMPOTENCY_KEY_CONFLICT`. Prisma `P2002` is never
returned to clients.

The idempotency service never opens or commits a transaction. Financial
mutation + binding + audit share the **caller-owned** transaction. A
rollback leaves no orphan operation row.

## Operation identity

`idempotency_records.id` (UUIDv7) is the FUP operation ID. A second UUID
column was not added. Future provider keys:

```text
fup:{sha256(fup + provider + operation + operationId)}
```

using NUL-separated material. No secrets. No client key.

When a future reserved command emits financial audit, include
`operationId`. Ordinary `payment.created` / `refund.created` audits are
not duplicated with `idempotency.record.created` rows.

## In-progress and unknown outcomes

| Status        | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| `IN_PROGRESS` | Operation reserved; FUP result is not yet conclusive.             |
| `COMPLETED`   | Canonical command result/binding is durable. Not “money settled”. |

There is **no** `FAILED` status. A provider timeout after the request was
sent is an **unknown outcome**, not a safe failure.

Never:

```text
timeout → delete idempotency record → retry as a new operation
```

That can double-charge or double-refund. The durable FUP operation must
survive ambiguity; later retrieve/reconcile may complete it.

Atomic create paths insert `COMPLETED` directly because mutation and
binding finish in one PostgreSQL transaction. Future provider commands
may `reserveInProgress` first, call the provider **outside** that
transaction, then `complete`. Same key + same fingerprint while
`IN_PROGRESS` returns `409 IDEMPOTENCY_OPERATION_IN_PROGRESS`. Clients may
retry the same key; they must not assume a completed result exists.

This table has **no worker lease**. Outbox leases remain a separate
concern. No financial outbox events were added in this commit.

## Retention

Idempotency records are retained **indefinitely**. There is no cron
cleanup and no silent expiry. A future retention policy must consider
provider dispute windows, retry windows, financial-record retention,
resource lifetime, and storage growth.

## Current create behavior

`POST /payments` and `POST /payments/:paymentId/refunds` still:

- require `Idempotency-Key`
- replay exact requests
- conflict on a different body
- serialize concurrent same-key creates to one resource
- roll back the binding when audit/mutation fails

Existing `payment.create` / `refund.create` fingerprints and key hashes
were not rewritten. Migrated rows are `COMPLETED`.
