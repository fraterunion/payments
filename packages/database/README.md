# @fraterunion-payments/database

This package is reserved for the future Prisma schema, migrations, and generated
client that will back FraterUnion Payments' internal data model (customers,
payment methods, payments, subscriptions, the internal ledger, and so on).

## Status

Schema initialization is intentionally deferred. This commit only establishes
the monorepo foundation; no database engine, connection, schema, or models are
defined yet. Prisma will be introduced in a later commit once the core domain
entities have been designed.
