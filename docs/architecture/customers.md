# Customers

Authoritative description of the canonical FraterUnion Payments customer
and its provider mappings. Implemented in
`packages/database` (schema) and `apps/api/src/customers`.

Last updated: 2026-09-02

## Canonical identity

```text
Organization
   │
   └── Customer (canonical FUP identity)
          │
          ├── Provider Mapping → Provider A customer
          ├── Provider Mapping → Provider B customer
          └── future financial records
```

A FraterUnion Payments `Customer` is **not** a Stripe customer, an Adyen
shopper, or any other provider object. It is a person or business an
organization may charge. It exists with zero, one, or many provider
mappings.

Provider-specific IDs are stored only on `CustomerProviderMapping`.

## Tenant ownership

Every customer and mapping row has an explicit `organizationId`. The
mapping also uses a composite foreign key
`(customerId, organizationId) → customers(id, organizationId)` so a
mapping cannot attach to another tenant's customer. Services never fetch
a customer by id without organization scope.

## Type, email, external reference, archive, metadata

| Field                   | Semantics                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                  | `INDIVIDUAL` (default) or `BUSINESS`. Payment identity, not KYC.                                                                                                                        |
| `email`                 | Optional contact field. Trimmed and lowercased. **Not unique.** Same email is not the same customer. No Gmail dots/plus normalization. Not authentication identity.                     |
| `phone`                 | Optional. Rejected unless valid E.164 (`+` and 1–15 digits, first digit not 0). No silent local-number rewriting.                                                                       |
| `name`                  | Single display/business name. Not first/last.                                                                                                                                           |
| `externalReference`     | Tenant-owned integration key (for example a GymOS member id). Unique per `(organizationId, externalReference)` when present. Not a provider ID. Create conflicts rather than upserting. |
| `status` / `archivedAt` | `ACTIVE` ⇔ `archivedAt IS NULL`. `ARCHIVED` ⇔ `archivedAt IS NOT NULL`. Enforced by CHECK. Archive is idempotent. No unarchive. No HTTP DELETE.                                         |
| `metadata`              | JSON object, ≤ 16 KiB. Forbidden secret/card keys. Not a place for provider mappings.                                                                                                   |

Archived customers are read-only. Existing mappings remain readable. New
mappings are rejected.

Physical deletion is not a product action. Future GDPR/anonymization will
need its own design.

## Provider mappings

Mappings are create/read only. Identity (`customerId`, `provider`,
account scope, `providerCustomerId`) does not update.

`provider` is a `PaymentProviderCode` from
`@fraterunion-payments/provider-contracts` — not a closed Prisma enum.

`providerAccountReference` is an optional opaque merchant/account string
(no FK; ProviderAccount is not implemented yet). Uniqueness uses
`providerAccountScope`:

| Account reference | Stored scope          |
| ----------------- | --------------------- |
| absent            | `default`             |
| `acct_connected`  | `acct:acct_connected` |

The `acct:` prefix prevents a real account id of `default` from colliding
with the no-account sentinel. SQL `NULL` uniqueness is not used.

Unique:

```text
(organizationId, provider, providerAccountScope, providerCustomerId)
(customerId, provider, providerAccountScope)
```

This commit stores a mapping for a provider resource that already exists
elsewhere. It does **not** call `PaymentProvider.createCustomer()`.

Mapping **creation is service-only**. It is not a public HTTP write,
because a later commit will create the mapping in the same transaction as
a provider adapter call. Authorized operators may **list** mappings:

```text
GET /api/v1/customers/:customerId/provider-mappings
```

## API and authorization

```text
POST   /api/v1/customers
GET    /api/v1/customers
GET    /api/v1/customers/:customerId
PATCH  /api/v1/customers/:customerId
POST   /api/v1/customers/:customerId/archive
GET    /api/v1/customers/:customerId/provider-mappings
```

Human JWT or organization API key, plus resolved organization context.

| Action | Human roles                               | API-key scopes    |
| ------ | ----------------------------------------- | ----------------- |
| Read   | OWNER, ADMIN, DEVELOPER, ANALYST, SUPPORT | `customers:read`  |
| Write  | OWNER, ADMIN, DEVELOPER                   | `customers:write` |

List defaults to `ACTIVE`, newest first, cursor `(createdAt, id)`, default
50 / max 100. Search (`q`) is organization-scoped `ILIKE` over name,
email, and `externalReference`. Provider IDs are not searchable here.

## PII and logging

Email, name, and phone belong on the customer row and authorized
responses only. Application logs use `customerId`, `organizationId`, and
`status`. Audit metadata records `customerType`, `status`, `hasEmail`,
`hasPhone`, `externalReferencePresent` — not the PII values.

## Audit and deferred outbox

Mutations and `AuditService.write` share one PostgreSQL transaction.

```text
customer.created
customer.updated
customer.archived
customer.provider_mapping_created
```

**Outbox emission is deferred.** The production worker's generic registry
has no customer-domain consumer. Enqueueing these events today would
claim them and mark them `FAILED`. Event emission belongs with a later
consumer/transport strategy.

## Future

Provider adapter `createCustomer` + mapping in one application
transaction, ProviderAccount persistence, restore/unarchive,
get-or-create by `externalReference`, GDPR anonymization, and customer
merge.
