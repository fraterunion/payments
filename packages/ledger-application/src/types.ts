import type { LedgerAccountType, LedgerSide } from '@fraterunion-payments/ledger-core';
import type {
  LedgerAccountBindingRole,
  Prisma,
  PrismaClient,
} from '@fraterunion-payments/database';

export type LedgerStore = PrismaClient | Prisma.TransactionClient;

export const LEDGER_LIST_DEFAULT_LIMIT = 25;
export const LEDGER_LIST_MAX_LIMIT = 100;

export const LEDGER_POST_SCOPE = 'ledger.transaction.post';
export const LEDGER_POST_RESOURCE_TYPE = 'ledgertransaction';

export const LEDGER_SYSTEM_ACCOUNT_ROLES = {
  PROVIDER_RECEIVABLE: 'PROVIDER_RECEIVABLE',
  SETTLEMENT_PAYABLE: 'SETTLEMENT_PAYABLE',
} as const;

export type LedgerSystemAccountRole =
  (typeof LEDGER_SYSTEM_ACCOUNT_ROLES)[keyof typeof LEDGER_SYSTEM_ACCOUNT_ROLES];

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

export type EnsureProviderLedgerAccountsInput = {
  readonly organizationId: string;
  readonly provider: string;
  readonly providerAccountScope: string;
  readonly currency: string;
};

export type ProviderLedgerAccounts = {
  readonly providerReceivableAccountId: string;
  readonly settlementPayableAccountId: string;
};

export type { LedgerAccountBindingRole };
