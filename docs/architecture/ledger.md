# Double-entry ledger

Authoritative description of the FraterUnion Payments internal ledger.
Implemented in `@fraterunion-payments/ledger-core` (pure accounting) and
`apps/api/src/ledger` (persistence). Schema lives in
`packages/database`. See [ADR-006](../decisions/ADR-006-append-only-double-entry-ledger.md)
and [`ledger-principles.md`](./ledger-principles.md).

Last updated: 2026-09-06

This commit is the ledger **engine**. Payment and Refund lifecycle
transitions do **not** post entries yet.

## Accounting truth

```text
LedgerEntries are source of accounting truth.
Balances are projections.
Transactions are immutable.
Corrections are additional transactions.
```

This is a provider-neutral double-entry journal. It is not a claim of
GAAP/IFRS compliance or regulatory certification.

```text
LedgerTransaction
      |
      +---- DEBIT  → LedgerAccount A
      |
      +---- CREDIT → LedgerAccount B
```

```text
entries = accounting truth
        ↓
SUM
        ↓
derived account balance
```

## Package boundaries

```text
payment/refund application
        ↓
ledger application (apps/api/src/ledger)
        ↓
ledger-core + database
```

Generic ledger infrastructure never imports a payment provider.
`packages/ledger-core` has no Prisma, Nest, Stripe, or API dependency.

## Model

`LedgerAccount` is organization-owned, single-currency, and identified by
`(organizationId, code)`. `type` is one of `ASSET`, `LIABILITY`,
`EQUITY`, `REVENUE`, `EXPENSE`. Normal balance is **derived** from type:

| Type      | Normal balance |
| --------- | -------------- |
| ASSET     | DEBIT          |
| EXPENSE   | DEBIT          |
| LIABILITY | CREDIT         |
| EQUITY    | CREDIT         |
| REVENUE   | CREDIT         |

`code` and `type` are immutable after create. Name may change. Archive
(`ARCHIVED`) keeps history readable and refuses new postings. There is
no delete API.

`LedgerTransaction` exists only when posted. There is no draft/void
state. `postedAt` is effective accounting time (defaults to now).
`createdAt` is insertion time.

`LedgerEntry` stores `amount > 0` and `side = DEBIT | CREDIT`. Amounts
are `BIGINT` minor units. No signed stored amounts. No floats.

Optional `referenceType` / `referenceId` are both null or both present.
They point at canonical FUP identities, never provider ids (`pi_`,
`re_`). Optional `reversesLedgerTransactionId` is a same-organization
pointer for compensating journals. Multiple compensations of one
original are allowed. A transaction cannot reverse itself.

## Double-entry enforcement

Application posting validates:

- at least two entries
- every amount `> 0`
- sum(debits) == sum(credits)
- every account belongs to the posting organization
- every account is `ACTIVE`
- every account currency equals the transaction currency

PostgreSQL also enforces a **deferred constraint trigger** at commit:

- entry count `>= 2`
- debit sum equals credit sum

Direct SQL cannot commit an empty, one-sided, or unbalanced journal.

Composite FKs keep entry organization identical to both the transaction
and the account.

## Append-only enforcement

`ledger_transactions` and `ledger_entries` reject `UPDATE`, `DELETE`,
and `TRUNCATE`.

`ledger_accounts` reject identity-field updates (`organizationId`,
`code`, `type`, `currency`), physical `DELETE`, and `TRUNCATE`.

## Posting

Internal only. No public HTTP write API.

```ts
await ledgerService.postTransaction({
  organizationId,
  idempotencyKey,
  transactionType: 'test.posting',
  currency: 'USD',
  entries: [
    { accountId: cashId, side: 'DEBIT', amount: 1000n },
    { accountId: revenueId, side: 'CREDIT', amount: 1000n },
  ],
});
```

Posting is one database transaction: resolve idempotency, load accounts,
validate, insert transaction + entries, bind `idempotency_records`
(`scope = ledger.transaction.post`). No external calls. No outbox event.

Duplicate lines to the same account (including debit and credit on one
account) are allowed. Fingerprints sort entries by
`accountId`, `side`, `amount` so caller order is not economically
meaningful.

## Idempotency

Reuses `idempotency_records`. Same organization + key + fingerprint
returns the same `LedgerTransaction`. Same key + different fingerprint
is `IDEMPOTENCY_KEY_CONFLICT`. Concurrent same-key posts yield one
transaction.

The fingerprint includes organization, transaction type, reference,
currency, description, metadata, reversal pointer, and canonicalized
entries.

## Balance derivation

No persisted mutable balance. `getAccountBalance(organizationId, accountId)`
aggregates `BIGINT` entries:

```text
DEBIT-normal  → debits - credits
CREDIT-normal → credits - debits
```

The result is a ledger-specific signed type (`LedgerBalance`), not
payment-core `Money` (which forbids negatives). JSON uses a string
amount. Future snapshots may cache this projection; entries remain
truth.

## Compensation

Never update a posted transaction. Post a new compensating journal.
`reversesLedgerTransactionId` is optional documentation of that link.

## Audit

Account create/archive write `ledger.account.created` /
`ledger.account.archived`. Posted transactions do **not** write
AuditLog — the ledger is the financial history. No per-entry audit.

## Isolation

Every query requires `organizationId`. Foreign accounts are
`LEDGER_ACCOUNT_NOT_FOUND` / `LEDGER_CROSS_TENANT_ACCOUNT`. Organization
delete is `RESTRICT` while ledger rows exist.

## What this commit is not

No automatic `payment.succeeded` / `refund.succeeded` posting. No Stripe
fee, settlement, payout, FX, revenue-recognition, or treasury accounts.
No public ledger HTTP API. No outbox `ledger.transaction.posted` event.
