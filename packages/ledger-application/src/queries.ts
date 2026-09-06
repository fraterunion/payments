import { Prisma, type LedgerAccount } from '@fraterunion-payments/database';
import {
  LEDGER_ERROR_CODES,
  LedgerError,
  canonicalizeLedgerCurrency,
  deriveLedgerBalance,
  ledgerBalanceToJSON,
  normalBalanceForAccountType,
  type LedgerBalanceJSON,
} from '@fraterunion-payments/ledger-core';
import { getLedgerTransaction, type PostedLedgerTransaction } from './post-transaction.js';
import {
  LEDGER_LIST_DEFAULT_LIMIT,
  LEDGER_LIST_MAX_LIMIT,
  type LedgerAccountListCursor,
  type LedgerTransactionListCursor,
  type LedgerStore,
  type ListLedgerAccountsQuery,
  type ListLedgerTransactionsQuery,
} from './types.js';

export type LedgerAccountListResult = {
  readonly items: readonly LedgerAccount[];
  readonly nextCursor: LedgerAccountListCursor | undefined;
};

export type LedgerTransactionListResult = {
  readonly items: readonly PostedLedgerTransaction[];
  readonly nextCursor: LedgerTransactionListCursor | undefined;
};

export async function getLedgerAccount(
  client: LedgerStore,
  organizationId: string,
  accountId: string,
): Promise<LedgerAccount> {
  const account = await client.ledgerAccount.findFirst({
    where: { id: accountId, organizationId },
  });
  if (account === null) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_ACCOUNT_NOT_FOUND,
      'Ledger account was not found.',
    );
  }
  return account;
}

export async function listLedgerAccounts(
  client: LedgerStore,
  query: ListLedgerAccountsQuery,
): Promise<LedgerAccountListResult> {
  const limit = boundedLimit(query.limit);
  const items = await client.ledgerAccount.findMany({
    where: {
      organizationId: query.organizationId,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.currency !== undefined
        ? { currency: canonicalizeLedgerCurrency(query.currency) }
        : {}),
      ...createdAtCursorWhere(query.cursor),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor:
      hasMore && last !== undefined ? { createdAt: last.createdAt, id: last.id } : undefined,
  };
}

export async function listLedgerTransactions(
  client: LedgerStore,
  query: ListLedgerTransactionsQuery,
): Promise<LedgerTransactionListResult> {
  const limit = boundedLimit(query.limit);
  const accountFilter =
    query.accountId === undefined
      ? {}
      : { entries: { some: { ledgerAccountId: query.accountId } } };
  const items = await client.ledgerTransaction.findMany({
    where: {
      organizationId: query.organizationId,
      ...accountFilter,
      ...(query.transactionType !== undefined ? { transactionType: query.transactionType } : {}),
      ...(query.referenceType !== undefined ? { referenceType: query.referenceType } : {}),
      ...(query.referenceId !== undefined ? { referenceId: query.referenceId } : {}),
      ...(query.currency !== undefined
        ? { currency: canonicalizeLedgerCurrency(query.currency) }
        : {}),
      ...(query.postedAfter !== undefined || query.postedBefore !== undefined
        ? {
            postedAt: {
              ...(query.postedAfter !== undefined ? { gte: query.postedAfter } : {}),
              ...(query.postedBefore !== undefined ? { lte: query.postedBefore } : {}),
            },
          }
        : {}),
      ...postedAtCursorWhere(query.cursor),
    },
    include: { entries: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor:
      hasMore && last !== undefined ? { postedAt: last.postedAt, id: last.id } : undefined,
  };
}

export async function getLedgerAccountBalance(
  client: LedgerStore,
  organizationId: string,
  accountId: string,
): Promise<LedgerBalanceJSON> {
  const account = await getLedgerAccount(client, organizationId, accountId);
  const totals = await client.$queryRaw<Array<{ debit_total: bigint; credit_total: bigint }>>`
    SELECT
      COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount ELSE 0 END), 0)::bigint AS debit_total,
      COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount ELSE 0 END), 0)::bigint AS credit_total
    FROM ledger_entries
    WHERE organization_id = ${organizationId}::uuid
      AND ledger_account_id = ${accountId}::uuid
  `;
  const debitTotal = totals[0]?.debit_total ?? 0n;
  const creditTotal = totals[0]?.credit_total ?? 0n;
  if (typeof debitTotal !== 'bigint' || typeof creditTotal !== 'bigint') {
    throw new Error('Ledger balance aggregation must remain bigint.');
  }
  return ledgerBalanceToJSON(
    deriveLedgerBalance({
      currency: account.currency,
      normalBalance: normalBalanceForAccountType(account.type),
      debitTotal,
      creditTotal,
    }),
  );
}

export { getLedgerTransaction };

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return LEDGER_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.max(1, limit), LEDGER_LIST_MAX_LIMIT);
}

function createdAtCursorWhere(
  cursor: LedgerAccountListCursor | undefined,
): Prisma.LedgerAccountWhereInput {
  if (cursor === undefined) {
    return {};
  }
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

function postedAtCursorWhere(
  cursor: LedgerTransactionListCursor | undefined,
): Prisma.LedgerTransactionWhereInput {
  if (cursor === undefined) {
    return {};
  }
  return {
    OR: [
      { postedAt: { lt: cursor.postedAt } },
      { postedAt: cursor.postedAt, id: { lt: cursor.id } },
    ],
  };
}
