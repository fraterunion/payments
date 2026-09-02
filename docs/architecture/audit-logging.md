# Audit logging

Authoritative description of append-only, tenant-scoped security audit.
Implementation lives in `apps/api/src/audit/` and the `audit_logs` table.
This is **not** the transactional outbox; see
[`event-delivery.md`](./event-delivery.md) and
[ADR-007](../decisions/ADR-007-transactional-outbox-and-inbox.md).

Last updated: 2026-09-02

## What audit is for

`AuditLog` answers:

```text
who did what, where, and when
```

`OutboxEvent` answers:

```text
what happened that another component may need to process
```

Do not emit an outbox event for every audit row. Do not treat the outbox
as a security log. Both can share one PostgreSQL transaction with a
domain mutation:

```text
BEGIN
  domain mutation
  audit.write(tx, ...)
  outbox.enqueue(tx, ...)
COMMIT
```

## Append-only invariant

Once an `AuditLog` row is committed it must never be `UPDATE`d or
`DELETE`d. Corrections are new rows.

PostgreSQL enforces this with `prevent_audit_log_mutation()` on
`BEFORE UPDATE OR DELETE` (and `BEFORE TRUNCATE`). The exception text is:

```text
audit_logs is append-only
```

`AuditService` has no update or delete methods. Application services must
not contain a legitimate path that mutates an existing audit row.

This is **application/database invariant protection**. A PostgreSQL
superuser can drop or disable triggers. This commit is not
cryptographically tamper-proof and does not use signatures, blockchain
anchoring, or WORM storage.

## Tenant ownership

`organizationId` is required. Tenant audit stays tenant-bound
(ADR-003). The service does not infer the organization from a user id
and does not accept an organization from an untrusted body — callers
pass the already-authorized tenant.

Platform-wide rows are **not** represented. Failed logins remain
unaudited because they have no attributable organization. Making
`organizationId` nullable would weaken the tenant contract without a
current product need.

## Actors

Application code uses a discriminated union. The service maps it to
columns so callers cannot set both FKs:

| Actor     | `actorUserId` | `actorApiKeyId` |
| --------- | ------------- | --------------- |
| `USER`    | set           | null            |
| `API_KEY` | null          | set             |
| `SYSTEM`  | null          | null            |

A CHECK constraint rejects both FKs at once. Exactly one actor is **not**
required — system actors are valid.

Actor FKs use `ON DELETE RESTRICT`. Historical rows keep the original
actor identifier. Users are deactivated and API keys are revoked; they
are not physically deleted while audit evidence references them.
Organizations remain `ON DELETE RESTRICT`.

## Actions and resources

Convention:

```text
<domain>.<past-tense-action>
```

Existing names are stable (`auth.registered`, `auth.login_succeeded`,
`auth.session_refreshed`, `auth.session_revoked`,
`auth.all_sessions_revoked`, `auth.refresh_reuse_detected`,
`api_key.created`, `api_key.revoked`). Do not rename them.

`resource.type` is an extensible string. Payment resource types are not
defined here.

## Safe metadata

Callers must construct only safe metadata. The infrastructure then
rejects the write (it does not silently redact) if:

- a key matches a forbidden token (`password`, `passwordHash`, `token`,
  `refreshToken`, `apiKey`, `secretHash`, `authorization`, `cookie`,
  `cardNumber`, `cvc`, `databaseUrl`, …) after case/underscore folding
- a string value looks like a Postgres URL, JWT, bearer token, or
  FraterUnion API key
- nesting exceeds 8 levels
- UTF-8 `JSON.stringify` size exceeds 16 KiB
- the value is not a JSON object (arrays/primitives at the root)

Because security-sensitive mutations write audit in the same
transaction, a rejected metadata payload rolls back the mutation. That
is intentional: a privileged change must not commit without its audit
row, and an audit row must not store secrets.

Request context is only `requestId`, `ipAddress`, and a user-agent
truncated to 512 characters. Raw headers, cookies, and Authorization
are never copied.

## Read model

`AuditService.list` is a service-only, tenant-scoped query. There is no
public `GET /audit` route in this commit.

- `organizationId` is mandatory
- filters: action, resource, actor, request ID, createdAt range
- newest first
- cursor `(createdAt, id)`
- default page 50, hard max 100

Retention, SIEM export, and an admin UI are deferred. Processed audit
rows are kept; there is no deletion policy yet.

## Indexes

Query paths are tenant-scoped, so indexes are org-prefixed:

- `(organizationId, createdAt)` — default newest-first
- `(organizationId, action, createdAt)`
- `(organizationId, resourceType, resourceId, createdAt)`
- `(organizationId, actorUserId, createdAt)`
- `(organizationId, actorApiKeyId, createdAt)`
- `(organizationId, requestId)`

## Relationship to append-only ledger

[ADR-006](../decisions/ADR-006-append-only-double-entry-ledger.md) uses
the same correction model for money: never edit a posted row; write a
new compensating record. Audit applies that idea to security evidence.
The ledger is not implemented in this commit.
