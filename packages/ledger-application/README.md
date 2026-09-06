# @fraterunion-payments/ledger-application

Persistence and idempotent posting for the FraterUnion Payments ledger.

Pure accounting math stays in `@fraterunion-payments/ledger-core`. This
package talks to PostgreSQL, reuses `idempotency_records` with
`scope = ledger.transaction.post`, and provisions provider-neutral
clearing-account bindings. It has no Nest, Stripe, or payment-domain
dependency.

```text
ledger-core
     ↑
ledger-application
     ↑
payment-application / apps/api
```

## Posting

`postLedgerTransaction(client, input)` uses the provided Prisma client
and does **not** open its own `$transaction`. Callers that need
atomicity with Payment/Refund/Inbox writes must pass an existing
transaction. Same-key posts take a transaction-scoped advisory lock so
PostgreSQL uniqueness conflicts do not abort the interactive transaction
before replay. `postedAt` is excluded from the idempotency fingerprint
so retries do not conflict when wall-clock time changes.

`ensureProviderLedgerAccounts` uses the same advisory-lock pattern for
first-use clearing-account provisioning.

## System account codes

When `ensureProviderLedgerAccounts` creates clearing accounts:

```text
FUP.{PR|SP}.{PROVIDER}.{CURRENCY}.{scopeHash12}
```

`PR` is Provider Receivable (`ASSET`). `SP` is Settlement Payable
(`LIABILITY`). `scopeHash12` is the first 12 uppercase hex characters of
SHA-256 of the exact `providerAccountScope` (`default` or
`acct:<id>`). Codes are deterministic, bounded, and never embed raw
provider account ids.

See [`docs/architecture/ledger.md`](../../docs/architecture/ledger.md) and
[`docs/architecture/payment-ledger-posting.md`](../../docs/architecture/payment-ledger-posting.md).
