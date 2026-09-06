# @fraterunion-payments/ledger-core

Pure double-entry accounting for FraterUnion Payments.

This package does not depend on Prisma, NestJS, Stripe, HTTP, or process
environment. It validates journals, derives signed balances, and
canonicalizes posting fingerprints. Persistence lives in `apps/api/src/ledger`.

```text
entries = accounting truth
        ↓
SUM
        ↓
derived account balance
```

See [`docs/architecture/ledger.md`](../../docs/architecture/ledger.md).

## What this package owns

- Debit / credit sides
- Account types and derived normal balance
- Positive-amount posting validation
- Double-entry balance (`sum(debits) == sum(credits)`)
- Signed `LedgerBalance` (may be negative)
- Account-code and transaction-type canonicalization
- Order-independent posting fingerprints

## What this package is not

- Not a chart of accounts
- Not Payment/Refund posting
- Not a provider adapter
- Not GAAP/IFRS certification
