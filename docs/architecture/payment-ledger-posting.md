# Payment and refund ledger posting

Authoritative description of how canonical Payment and Refund economic
facts post into the FraterUnion Payments operational subledger.

See [`ledger.md`](./ledger.md) for the generic engine,
[`ledger-principles.md`](./ledger-principles.md) for invariants, and
[`stripe-webhook-normalization.md`](./stripe-webhook-normalization.md)
for the provider-observation path that calls this posting.

Last updated: 2026-09-06

## Operational subledger, not merchant revenue

FraterUnion Payments does **not** know whether a Payment is a sale,
deposit, membership, loan repayment, reservation, or receivable
collection. Incoming customer captures are therefore **never** classified
as `REVENUE`, `SALES`, or `INCOME`.

V1 records an operational clearing position:

```text
Captured Payment

Provider Receivable (Asset)
      DR 10,000
             |
             v
Settlement Payable (Liability)
      CR 10,000
```

Interpretation: the provider owes settlement funds, and the same amount
is pending settlement in FUP's operational payment subledger. This is
not corporate revenue recognition.

```text
Refund

Settlement Payable
      DR 2,500
             |
             v
Provider Receivable
      CR 2,500
```

A refund reverses the unsettled economic position. It does not post
against a Revenue account.

## When journals exist

A capture journal is required whenever the Payment represents
successfully captured funds:

```text
SUCCEEDED | PARTIALLY_REFUNDED | REFUNDED
AND capturedAmount > 0
```

Authorization is not captured money. These states post **zero** rows:

```text
AUTHORIZING
AUTHORIZED
REQUIRES_ACTION
REQUIRES_PAYMENT_METHOD
FAILED
CANCELED
```

A refund journal is required only when `Refund.status == SUCCEEDED`.
`CREATED`, `PROCESSING`, and `FAILED` produce zero refund journals.

Later refund-derived Payment statuses do **not** create a second
`payment.capture` journal. The original capture remains one immutable
journal; refund journals account for the reversals.

`capturedAmount <= 0` on a captured-family Payment is an anomaly
(`LEDGER_PAYMENT_INVALID_CAPTURE_AMOUNT`). Zero journals are never
posted.

## Journals

### Payment capture

```text
DEBIT   PROVIDER_RECEIVABLE   Payment.capturedAmount
CREDIT  SETTLEMENT_PAYABLE    Payment.capturedAmount
```

- `transactionType = payment.capture`
- `referenceType = payment`
- `referenceId =` canonical Payment UUID
- `description = Payment capture`
- amount is `capturedAmount`, never `requestedAmount`

Partial final capture of `6000` against a `10000` request posts `6000`.

### Refund

```text
DEBIT   SETTLEMENT_PAYABLE    Refund.amount
CREDIT  PROVIDER_RECEIVABLE   Refund.amount
```

- `transactionType = refund`
- `referenceType = refund`
- `referenceId =` canonical Refund UUID
- `description = Refund`
- amount is `Refund.amount`, not a `Payment.refundedAmount` delta

Canonical references are FUP UUIDs. Do not use `pi_…`, `re_…`,
`evt_…`, or `acct_…` as ledger identity.

## Provider / account / currency isolation

Receivable and payable must be distinguishable by:

```text
organization
provider
providerAccountScope
currency
```

`providerAccountScope` reuses the execution convention: `default` for
the platform account, `acct:<opaque-id>` for a connected account. Raw
`providerAccountReference` is not stored on the binding.

Stripe USD, Moneris USD, and Stripe connected `acct:A` USD are
different clearing books. Generic provider object ids that collide
(`abc123` on Stripe and Moneris) stay provider-qualified.

## LedgerAccountBinding

Posting never looks up accounts by human code. It resolves through an
immutable, provider-neutral binding:

```text
unique (organizationId, role, provider, providerAccountScope, currency)
```

Roles in this commit:

| Role                  | Account type |
| --------------------- | ------------ |
| `PROVIDER_RECEIVABLE` | `ASSET`      |
| `SETTLEMENT_PAYABLE`  | `LIABILITY`  |

Account currency must equal binding currency. Account, binding, and
Payment/Refund must share the same organization. Composite FK
`(ledgerAccountId, organizationId) → ledger_accounts` makes
cross-tenant binding impossible. Organization and account FKs are
`RESTRICT`.

Bindings are immutable after insert. Corrections require a future
administrative migration. Bound accounts cannot be archived.

There is no public HTTP API for bindings.

## Account provisioning

`ensureProviderLedgerAccounts` is an internal, idempotent service.
If bindings are missing it creates the two system accounts and binds
them. Concurrent first-use converges to one pair.

System account codes are deterministic and bounded:

```text
FUP.{PR|SP}.{PROVIDER}.{CURRENCY}.{scopeHash12}
```

`scopeHash12` is the first 12 uppercase hex characters of SHA-256 of
the exact `providerAccountScope` string. Raw provider account ids never
appear in the code. Display names such as `Stripe Provider Receivable`
are human-readable only; there is no Stripe-specific enum.

## Economic idempotency

Ledger identity is the canonical economic fact, **not** a Stripe Event
ID. Different Event IDs can represent the same capture or refund
(`refund.created` succeeded and `refund.updated` succeeded).

Deterministic internal keys (never public, never the webhook
`Idempotency-Key`):

```text
ledger:payment:capture:<paymentId>
ledger:refund:<refundId>
```

Scope remains Commit 19's `ledger.transaction.post`. Replay returns the
same `LedgerTransaction`.

Metadata is limited to stable business identifiers:

```json
{
  "source": "provider_execution",
  "provider": "stripe",
  "paymentProviderExecutionId": "<UUID>",
  "refundProviderExecutionId": "<UUID>"
}
```

Do **not** store webhook event IDs, `pi_` / `re_` / `acct_` ids,
timestamps, worker ids, full provider events, `client_secret`, payment
methods, card data, or raw payloads. Those would change the Commit 19
fingerprint and turn a replay into `IDEMPOTENCY_KEY_CONFLICT`.

`postedAt` is defaulted by PostgreSQL after reservation and is excluded
from the fingerprint.

## Transaction atomicity

Payment success and Refund success participate in the existing
financial transaction:

```text
BEGIN
  lock Inbox
  lock Payment
  [lock Refund]
  apply observation
  write AuditLog
  ensure clearing accounts/bindings
  post ledger journal
  mark Inbox PROCESSED
COMMIT
```

If ledger posting fails, Payment/Refund mutation, audit, Inbox
finalization, and ledger rows all roll back. Inbox stays retryable.

`LedgerService.postTransaction` still opens its own transaction for
generic journals. Payment/Refund posting uses
`postLedgerTransaction(tx, …)` / `postTransactionInTransaction` so it
does not nest an independent commit.

## Ensure semantics (convergence, not transition-only)

Do not post only when `oldStatus != newStatus`. Canonical state created
before this commit may already be `SUCCEEDED` / refunded. Reprocessing
an economically equivalent observation **ensures** the journal exists:

- missing → create exactly once
- present → replay / no-op

This is safe backfill through normal processing. There is **no**
one-off migration that blindly posts historical financial rows. A
future explicit backfill tool can scan historical records if production
ever requires it.

Refund processing also ensures the original capture journal before
posting the refund journal.

## Intentionally deferred

- Provider fees (`balance_transaction`, fee, net)
- Settlement / payout clearing of receivable and payable
- Application fees, destination charges, `transfer_data`
- Reconciliation (next commit)
- Public `POST /payments` Stripe execution
- Outbox `ledger.*` / `payment.succeeded` events
- Per-entry AuditLog (`ledger.entry.created`)
- Mutable stored balances

Account create/archive may still write `ledger.account.created` /
`ledger.account.archived` through the existing account service.

## Package boundaries

```text
ledger-core
     ↑
ledger-application
     ↑
payment-application
     ↑
apps/api / apps/worker
```

`ledger-core` remains pure accounting. `ledger-application` owns Prisma
posting, bindings, and provisioning. `payment-application` composes
Payment/Refund journals. Apps wrap Nest. No package depends on an app.
Ledger application does not depend on payment-application or Stripe.

## Reconciliation-friendly provenance

A later reconciliation commit can trace:

```text
Payment UUID
  → PaymentProviderExecution UUID
  → provider / account scope
  → LedgerTransaction
```

without storing raw provider payloads. Do not add reconciliation tables
here.
