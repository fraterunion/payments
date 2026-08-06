# FraterUnion Payments — Ledger Principles

## Status

Authoritative on principles and invariants; conceptual on entities,
account categories, and examples. No ledger schema is implemented yet, and
none is defined by this document. The chart of accounts and exact
debit/credit orientation shown here are illustrative and will be validated
before implementation — see the caveat before the [Examples](#examples)
section.

Last updated: 2026-08-06

## Core principles

- **Double-entry accounting.** Every financial event posts as a balanced
  set of debit and credit entries, never a single-sided adjustment.
- **Append-only entries.** Ledger entries are written once and never
  updated or deleted; corrections are new, compensating entries.
- **Balanced transactions.** For every ledger transaction, the sum of
  debit entries equals the sum of credit entries.
- **Integer minor units.** Amounts are stored as integers in a currency's
  minor unit (for example, cents for USD/MXN), never as floating-point
  values.
- **Explicit currency.** Every entry carries an explicit currency; amounts
  are never assumed to be in a default currency.
- **No floating-point money.** No monetary amount, anywhere in the ledger,
  is represented as a floating-point number, at rest or in transit.
- **Immutable historical entries.** Once posted, an entry is permanent;
  history is never rewritten, even to fix a mistake (see reversals below).
- **Reversals through compensating transactions.** Correcting a posted
  transaction means posting a new transaction that reverses its effect,
  preserving both the original and the correction in history.
- **Idempotent posting.** Posting the same financial event twice (for
  example, due to a duplicate webhook) must not create duplicate ledger
  entries.
- **Traceability to source.** Every ledger transaction is traceable to the
  payment, refund, fee, payout, or reconciliation event that caused it.
- **Tenant separation.** Ledger transactions and accounts are scoped to a
  single organization; no ledger transaction spans multiple tenants.
- **UTC timestamps.** All ledger timestamps are recorded in UTC.
- **Operational state vs. accounting state.** A payment's operational
  state (see [`payment-lifecycle.md`](./payment-lifecycle.md)) and its
  accounting representation in the ledger are distinct concepts: the
  operational state machine governs what the platform and consumer
  products see; the ledger governs the financial record. The two must stay
  consistent, but they are not the same data.

## Proposed entities

The following are anticipated conceptually. No schema is defined here:

- **LedgerAccount** — a named account within an organization's chart of
  accounts (see [Account categories](#account-categories)).
- **LedgerTransaction** — a balanced group of entries representing one
  financial event, with a source reference and timestamp.
- **LedgerEntry** — a single debit or credit line within a
  LedgerTransaction, against one LedgerAccount, in one currency.
- **BalanceSnapshot** — a computed, point-in-time balance for a
  LedgerAccount, used to avoid recomputing balances from full history on
  every read.
- **Settlement** — a record of funds a provider has paid out, used to
  reconcile provider payouts against expected ledger balances.
- **ReconciliationRun** — an execution of the reconciliation process
  comparing provider data against internal records over a given period.
- **ReconciliationItem** — a single comparison result within a
  ReconciliationRun (matched, missing, duplicate, or amount-mismatched).

## Account categories

Potential account types, to be validated before implementation:

- **Provider clearing** — funds recognized as collected by the provider,
  in transit before settlement.
- **Merchant receivable** — amounts attributable to the merchant/tenant
  for completed payments, pending settlement.
- **Processing expense** — provider fees recognized as an expense.
- **Refund liability** — amounts owed back to customers for refunds in
  progress.
- **Dispute reserve** — funds held back or reserved against open disputes
  or chargebacks.
- **Merchant bank** — the merchant/tenant's bank account, once funds have
  settled out of provider clearing.
- **Revenue / platform-fee accounts** — reserved for a future FraterUnion
  platform fee model; not used while no such fee exists.

The final chart of accounts, including which of these are asset, liability,
or expense in nature, and their exact debit/credit orientation, will be
validated before implementation — see the [Examples](#examples) caveat.

## Examples

The following examples are conceptual illustrations of how a payment's
financial effects might be posted using the account categories above. They
are not a finalized chart of accounts. The specific accounts touched,
their debit/credit orientation, and whether some of these postings are
combined into fewer transactions in the real implementation are all open
questions to be resolved before the ledger is built. Amounts are shown in
decimal for readability; the actual ledger stores integer minor units.

### Successful payment (100.00)

| Account             |  Debit | Credit |
| ------------------- | -----: | -----: |
| Provider clearing   | 100.00 |        |
| Merchant receivable |        | 100.00 |

The provider has collected 100.00 from the customer. This is recognized as
funds in transit (provider clearing) and as an amount attributable to the
merchant pending fees and settlement (merchant receivable).

### Provider fee (3.00)

| Account             | Debit | Credit |
| ------------------- | ----: | -----: |
| Processing expense  |  3.00 |        |
| Merchant receivable |       |   3.00 |

The provider's fee for this payment is recognized as an expense and
reduces the amount attributable to the merchant. After this entry,
merchant receivable for this payment reflects 97.00.

### Settlement (97.00)

| Account             | Debit | Credit |
| ------------------- | ----: | -----: |
| Merchant receivable | 97.00 |        |
| Provider clearing   |       |  97.00 |

The net amount is settled out of provider clearing. Merchant receivable
for this payment is reduced to zero; the corresponding funds are
considered to have left provider clearing toward the merchant's bank
account.

### Partial refund (25.00)

| Account           | Debit | Credit |
| ----------------- | ----: | -----: |
| Refund liability  | 25.00 |        |
| Provider clearing |       |  25.00 |

A partial refund of 25.00 is issued against the original payment. Funds
are recognized as drawn back out of provider clearing, and a refund
liability is recognized for the amount owed back to the customer. This
transaction is separate from, and does not modify, the entries created for
the original payment.

## Invariants

- The sum of debits equals the sum of credits for every posted
  transaction.
- A transaction has at least two entries.
- All entries in a transaction share the same currency.
- Amounts are positive integers in minor units; direction (debit/credit)
  encodes sign, not a negative amount.
- Posted entries cannot be updated or deleted.
- The same financial event cannot post twice (idempotent posting, keyed by
  source event).
- Cross-tenant ledger transactions are forbidden — every transaction
  belongs to exactly one organization.
- Provider references and internal source references are traceable from
  every ledger transaction back to the payment, refund, fee, payout, or
  reconciliation event that produced it.

## Reconciliation

Reconciliation compares provider execution and balance data (transactions,
fees, payouts) against FraterUnion Payments' own operational records and
ledger, to confirm they agree. It:

- Identifies missing records (present at the provider, absent
  internally, or vice versa), duplicate records, and amount mismatches.
- Does not silently auto-correct material discrepancies — a mismatch is
  surfaced for investigation, not resolved by assumption.
- Preserves investigation and resolution history: how a discrepancy was
  identified, investigated, and ultimately resolved is itself recorded,
  not overwritten once resolved.
- Uses compensating entries, not edits, when an accounting correction is
  determined to be necessary as a result of an investigation — consistent
  with the append-only principle above.

## Ledger limitations

The internal ledger described here is not automatically:

- A complete general ledger for FraterUnion as a business.
- A tax accounting system.
- A merchant bank statement.
- A substitute for professional accounting.
- Proof of regulatory or financial compliance.

It is a purpose-built internal record for tracking payment-related money
movement accurately enough to support reconciliation, operational
reporting, and auditability of the payment platform itself.

## Related decisions

- [ADR-002](../decisions/ADR-002-postgresql-and-prisma.md) — the
  transactional datastore the ledger's balanced-transaction guarantees
  depend on.
- [ADR-006](../decisions/ADR-006-append-only-double-entry-ledger.md) —
  the binding decision behind the principles above.
- [ADR-009](../decisions/ADR-009-integer-minor-units-for-money.md) — the
  amount representation used in every ledger entry.
- [ADR-010](../decisions/ADR-010-utc-time-and-iso-currencies.md) — the
  timestamp representation used in every ledger transaction.
