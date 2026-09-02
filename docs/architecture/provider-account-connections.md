# Provider account connections

Canonical organization-owned merchant processor connections.

Last updated: 2026-09-02

## Model

```text
Organization
    |
    v
ProviderAccountConnection
    |
    | provider = stripe
    v
Stripe Connect Account
    |
    v
Stripe-hosted onboarding
```

A Stripe connected account is **not** the FraterUnion organization.
`organizations` has no `stripeAccountId`. Persistence is provider-neutral
so a later organization may connect Stripe, Moneris, Adyen, OpenPay,
Conekta, or another processor.

FraterUnion Payments orchestrates. It does not custody merchant funds,
pool proceeds, redistribute settlement, or become a wallet.

Public Payments and Refunds are **not** routed through the connected
account in this commit.

## Persistence

`ProviderAccountConnection`:

| Field                                | Notes                                            |
| ------------------------------------ | ------------------------------------------------ |
| `id`                                 | UUIDv7 PK                                        |
| `organizationId`                     | FK → Organization, `RESTRICT`                    |
| `provider`                           | extensible VARCHAR (`PaymentProviderCode` shape) |
| `providerAccountId`                  | opaque external identity                         |
| `status`                             | FUP canonical, not a Stripe string               |
| `paymentsEnabled` / `payoutsEnabled` | operational booleans                             |
| `requirementsDue`                    | boolean only — no KYC object                     |
| `createdAt` / `updatedAt`            | `timestamptz(3)`                                 |

No Stripe-named columns. No onboarding URL. No bank, tax, SSN, person, or
verification-document storage. No physical delete API.

V1 uniqueness:

```text
(organizationId, provider)
(provider, providerAccountId)
```

One active Stripe merchant connection per organization. The same external
account cannot bind two organizations. Conflict is stable — FUP never
returns another tenant's connection.

`CustomerProviderMapping.providerAccountReference` remains an optional
opaque string. Future mappings will copy the connection's provider account
id into that field. No FK was added in this commit.

## Status

```text
PENDING          account exists; required capabilities are not yet conclusive
REQUIRES_ACTION  merchant must complete provider requirements
ACTIVE           required payment and payout capabilities are available
RESTRICTED       requested capabilities are blocked without a currently-due path
DISCONNECTED     provider account is closed / unusable (not set by V1 APIs)
```

`ACTIVE` requires both `paymentsEnabled` and `payoutsEnabled`.

## HTTP

```text
POST /api/v1/provider-connections/stripe
GET  /api/v1/provider-connections
GET  /api/v1/provider-connections/:connectionId
POST /api/v1/provider-connections/:connectionId/onboarding-link
POST /api/v1/provider-connections/:connectionId/refresh
```

There is no `DELETE` and no `/stripe/accounts`. Create and onboarding-link
are human JWT `OWNER`/`ADMIN` only. API keys cannot connect a processor.
Read: `OWNER`, `ADMIN`, `DEVELOPER`, `ANALYST`, `SUPPORT` with
`provider-connections:read`. Refresh: `OWNER`/`ADMIN` or an API key with
`provider-connections:write`.

Create requires `Idempotency-Key`. The public DTO does not include
`providerAccountId`. Onboarding-link responses set `Cache-Control: no-store`.

## Provisioning

```text
reserve operation
      ↓
Stripe create account
      ↓
persist connection
      ↓
complete operation
```

The Stripe call is never inside a PostgreSQL transaction.

```text
TX 1: reserve IN_PROGRESS (resourceId = future connection UUID)
Stripe: create connected account with deriveProviderIdempotencyKey(...)
TX 2: persist ProviderAccountConnection + audit + complete
```

If Stripe times out, the operation stays `IN_PROGRESS`. Retrying the same
client key resumes the same FUP operation and the same provider
idempotency key. Generic `resolveReplay` still returns
`IDEMPOTENCY_OPERATION_IN_PROGRESS` for other commands; Connect create
uses an orchestration-level resume instead of that 409.

A **different** client key while an `IN_PROGRESS` `provider.account.create`
exists for the organization is `PROVIDER_CONNECTION_CREATE_IN_PROGRESS`.
That prevents a second Stripe account from being provisioned.

Scope: `provider.account.create`. Resource type: `connection`.

## Refresh

Browser return from Stripe is not authoritative. Refresh retrieves the
provider account, then locks the connection row, persists normalized
readiness, and audits. The Stripe retrieve happens **before** the row
lock.

Stripe's Account Link refresh URL means **mint a new link**, never reuse
the previous URL.

## Audit

```text
provider_connection.created
provider_connection.onboarding_link_created
provider_connection.refreshed
provider_connection.status_changed
```

Safe metadata only: `connectionId`, `provider`, `status`,
`paymentsEnabled`, `payoutsEnabled`, `requirementsDue`. No URL, Stripe
object, KYC, emails, persons, bank details, or secrets.
`status_changed` is omitted when readiness is unchanged.

Outbox events are deferred — no consumer exists yet.

## Errors

```text
PROVIDER_CONNECTION_NOT_FOUND
PROVIDER_CONNECTION_ALREADY_EXISTS
PROVIDER_CONNECTION_NOT_READY
PROVIDER_CONNECTION_CREATE_IN_PROGRESS
PROVIDER_ONBOARDING_LINK_FAILED
PROVIDER_CONFIGURATION_ERROR
IDEMPOTENCY_KEY_REQUIRED
IDEMPOTENCY_KEY_CONFLICT
```

Foreign connection ids are `PROVIDER_CONNECTION_NOT_FOUND`. Stripe types
and raw account ids are not exposed.
