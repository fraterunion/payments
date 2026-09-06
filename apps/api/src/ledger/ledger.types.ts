import type { LedgerAccountType, LedgerSide } from '@fraterunion-payments/ledger-core';

export const LEDGER_LIST_DEFAULT_LIMIT = 25;
export const LEDGER_LIST_MAX_LIMIT = 100;

export type CreateLedgerAccountInput = {
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly type: LedgerAccountType;
  readonly currency: string;
};

export type LedgerAccountListCursor = {
  readonly createdAt: Date;
  readonly id: string;
};

export type ListLedgerAccountsQuery = {
  readonly organizationId: string;
  readonly status?: 'ACTIVE' | 'ARCHIVED';
  readonly currency?: string;
  readonly limit?: number;
  readonly cursor?: LedgerAccountListCursor;
};

export type LedgerTransactionListCursor = {
  readonly postedAt: Date;
  readonly id: string;
};

export type ListLedgerTransactionsQuery = {
  readonly organizationId: string;
  readonly accountId?: string;
  readonly transactionType?: string;
  readonly referenceType?: string;
  readonly referenceId?: string;
  readonly currency?: string;
  readonly postedAfter?: Date;
  readonly postedBefore?: Date;
  readonly limit?: number;
  readonly cursor?: LedgerTransactionListCursor;
};

export type PostLedgerTransactionInput = {
  readonly organizationId: string;
  readonly idempotencyKey: string;
  readonly transactionType: string;
  readonly currency: string;
  readonly entries: readonly {
    readonly accountId: string;
    readonly side: LedgerSide | string;
    readonly amount: bigint;
  }[];
  readonly reference?: { readonly type: string; readonly id: string };
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
  readonly reversesLedgerTransactionId?: string;
  readonly postedAt?: Date;
};
