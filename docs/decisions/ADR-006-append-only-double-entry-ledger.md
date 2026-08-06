# ADR-006: Append-only double-entry ledger

## Status

Accepted

Last updated: 2026-08-06

## Context

Provider reports alone are insufficient as FraterUnion Payments' internal
financial record: they reflect the provider's view, arrive asynchronously,
and do not by themselves give FraterUnion an auditable, queryable history
of what happened inside its own system. Refunds, fees, settlements, and
reconciliation (see
[`../architecture/ledger-principles.md`](../architecture/ledger-principles.md))
all require a durable financial history that can be trusted independently
of any single provider API call succeeding or being retrievable later.

## Decision

- FraterUnion Payments' internal financial representation uses double-entry
  accounting: every financial event posts as a balanced set of debit and
  credit entries.
- Posted ledger entries are append-only — never updated or deleted.
- Every ledger transaction balances (sum of debits equals sum of credits).
- Corrections to posted transactions use compensating transactions, never
  edits to what was already posted.
- Operational payment state (see
  [`../architecture/payment-lifecycle.md`](../architecture/payment-lifecycle.md))
  and ledger state are kept as distinct concepts that must stay consistent
  with each other but are not the same data.
- Ledger posting is idempotent: the same financial event cannot post
  twice.

## Consequences

### Positive

- Strong auditability: the full history of every financial event is
  preserved and inspectable, including corrections.
- Reconciliation and investigation (see
  [`../architecture/ledger-principles.md`](../architecture/ledger-principles.md#reconciliation))
  have a stable, trustworthy internal record to compare provider data
  against.
- Idempotent, append-only posting directly supports the platform's
  idempotency-everywhere-money-moves principle (see
  [`../product/vision.md`](../product/vision.md#product-principles)).

### Negative

- Materially higher implementation complexity than a mutable
  balance-tracking table — every financial mutation becomes a
  transaction-construction problem, not a simple update.
- Requires a carefully designed chart of accounts (see
  [`../architecture/ledger-principles.md`](../architecture/ledger-principles.md#account-categories))
  before the ledger can be implemented correctly.
- Querying current balances efficiently from an append-only log requires
  additional infrastructure (for example, balance snapshots) rather than
  a trivial column read.

### Risks and mitigations

- **The same event posts twice due to a retried request or duplicate
  webhook.** Mitigated by idempotent posting keyed to a stable source-event
  identifier, enforced at the database level (see
  [Implementation implications](#implementation-implications)).
- **An unbalanced transaction is posted due to an application bug.**
  Mitigated by validating that debits equal credits before commit, and by
  database constraints where practical.
- **The chart of accounts turns out to be wrong once real transactions
  flow through it.** Mitigated by explicitly treating the chart of
  accounts as provisional until validated against real payment, fee, and
  settlement flows (see
  [`../architecture/ledger-principles.md`](../architecture/ledger-principles.md#account-categories));
  amending it does not require reversing this ADR's core accounting model.

## Alternatives considered

- **A mutable transaction table** (updating a payment's amount/status
  fields directly as the source of financial truth). Rejected — it
  provides no audit trail of how a balance was reached and makes
  corrections indistinguishable from the original event.
- **Single-entry balance changes** (recording only net effect, not
  balanced debit/credit pairs). Rejected — it cannot express where money
  conceptually moved from and to, which is exactly what reconciliation and
  investigation need.
- **Relying on provider reports as the only financial record.** Rejected
  — providers report their own execution, not FraterUnion's internal
  view, and are not always available for arbitrary historical queries in
  the shape FraterUnion needs.
- **An event log without accounting entries** (storing domain events but
  not double-entry postings). Rejected — an event log can record that
  something happened, but not, on its own, guarantee that recorded
  financial effects are balanced and traceable the way double-entry
  accounting does.

## Implementation implications

- Ledger writes require database transactions and constraints sufficient
  to enforce balance and append-only behavior.
- Every ledger transaction must carry a stable identifier tracing it back
  to its source event (payment, refund, fee, settlement, or
  reconciliation adjustment).
- No code path may update or delete a posted ledger entry; corrections are
  always new, compensating transactions.
- Reversal workflows must be explicitly designed, not improvised per
  incident.
- Ledger transactions respect tenant and currency boundaries: no
  transaction spans multiple organizations or mixes currencies within one
  transaction (see
  [`../architecture/ledger-principles.md`](../architecture/ledger-principles.md#invariants)).
- Balanced-transaction validation must occur before a transaction is
  considered successfully posted.

## Revisit conditions

- The final chart of accounts requires amendment as real payment, fee, and
  settlement flows are implemented — this refines the model without
  reversing this ADR's core decision.
- Custody, platform fees, payouts, or marketplace-style split payments are
  introduced — any of these would likely require new account categories
  and possibly new posting rules, warranting a new ADR.
- Any change to the core accounting semantics decided here (double-entry,
  append-only, balanced) requires a new ADR that explicitly supersedes
  this one.
