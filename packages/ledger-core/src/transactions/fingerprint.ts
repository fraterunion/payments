import { canonicalizeLedgerCurrency } from '../currency.js';
import {
  canonicalizeLedgerDescription,
  canonicalizeLedgerReference,
  canonicalizeLedgerTransactionType,
} from './transaction-type.js';
import {
  canonicalizeLedgerPostingLines,
  sortLedgerPostingLines,
  type LedgerPostingLine,
} from './posting.js';

export type LedgerPostingFingerprintInput = {
  readonly organizationId: string;
  readonly transactionType: string;
  readonly currency: string;
  readonly entries: readonly {
    readonly accountId: string;
    readonly side: string;
    readonly amount: bigint;
  }[];
  readonly reference?: { readonly type: string; readonly id: string };
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
  readonly reversesLedgerTransactionId?: string;
};

export type CanonicalLedgerPosting = {
  readonly organizationId: string;
  readonly transactionType: string;
  readonly currency: string;
  readonly entries: readonly LedgerPostingLine[];
  readonly referenceType: string | null;
  readonly referenceId: string | null;
  readonly description: string | null;
  readonly metadata: Record<string, unknown>;
  readonly reversesLedgerTransactionId: string | null;
};

/**
 * Canonical posting shape used for idempotency fingerprints.
 * Entry order is sorted by accountId, side, amount so economically
 * identical journals hash the same regardless of caller order.
 */
export function canonicalizeLedgerPosting(
  input: LedgerPostingFingerprintInput,
): CanonicalLedgerPosting {
  const posting = canonicalizeLedgerPostingLines(input.entries);
  const reference = canonicalizeLedgerReference(input.reference);
  const description = canonicalizeLedgerDescription(input.description);
  return {
    organizationId: input.organizationId.trim(),
    transactionType: canonicalizeLedgerTransactionType(input.transactionType),
    currency: canonicalizeLedgerCurrency(input.currency),
    entries: sortLedgerPostingLines(posting.entries),
    referenceType: reference?.type ?? null,
    referenceId: reference?.id ?? null,
    description: description ?? null,
    metadata: input.metadata ?? {},
    reversesLedgerTransactionId: input.reversesLedgerTransactionId?.trim() ?? null,
  };
}

export function ledgerPostingFingerprintPayload(
  posting: CanonicalLedgerPosting,
): Record<string, unknown> {
  return {
    currency: posting.currency,
    description: posting.description,
    entries: posting.entries.map((entry) => ({
      accountId: entry.accountId,
      amount: entry.amount.toString(10),
      side: entry.side,
    })),
    metadata: posting.metadata,
    referenceId: posting.referenceId,
    referenceType: posting.referenceType,
    reversesLedgerTransactionId: posting.reversesLedgerTransactionId,
    transactionType: posting.transactionType,
  };
}
