import { Injectable } from '@nestjs/common';
import {
  LedgerAccountStatus,
  Prisma,
  type LedgerEntry,
  type LedgerTransaction,
} from '@fraterunion-payments/database';
import {
  LEDGER_ERROR_CODES,
  LedgerError,
  assertSameLedgerCurrency,
  canonicalizeLedgerCurrency,
  canonicalizeLedgerPosting,
  deriveLedgerBalance,
  ledgerPostingFingerprintPayload,
  ledgerBalanceToJSON,
  normalBalanceForAccountType,
  type LedgerBalanceJSON,
} from '@fraterunion-payments/ledger-core';
import { canonicalizeCurrencyCode } from '@fraterunion-payments/payment-core';
import { PinoLogger } from 'nestjs-pino';
import type { AuditActor } from '../audit/audit.types';
import type { RequestContext } from '../auth/types/request-context.type';
import { DatabaseService } from '../database/database.service';
import type { DatabaseClient } from '../database/database.types';
import { fingerprintFinancialCommand, parseApiIdempotencyKey } from '../idempotency/idempotency';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { IDEMPOTENCY_RESOURCE_TYPES, IDEMPOTENCY_SCOPES } from '../idempotency/idempotency.types';
import { assertSafeLedgerMetadata } from './ledger-metadata';
import {
  LedgerAccountNotFoundException,
  LedgerConcurrencyConflictException,
  LedgerTransactionNotFoundException,
  isIdempotencyUnique,
  mapLedgerDomainError,
} from './ledger.exceptions';
import {
  LEDGER_LIST_DEFAULT_LIMIT,
  LEDGER_LIST_MAX_LIMIT,
  type LedgerTransactionListCursor,
  type ListLedgerTransactionsQuery,
  type PostLedgerTransactionInput,
} from './ledger.types';

export type PostedLedgerTransaction = LedgerTransaction & {
  readonly entries: readonly LedgerEntry[];
};

export type LedgerTransactionListResult = {
  readonly items: readonly PostedLedgerTransaction[];
  readonly nextCursor: LedgerTransactionListCursor | undefined;
};

type LedgerStore = DatabaseClient | Prisma.TransactionClient;

@Injectable()
export class LedgerService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LedgerService.name);
  }

  async postTransaction(
    input: PostLedgerTransactionInput,
    _actor?: AuditActor,
    _requestContext?: RequestContext,
  ): Promise<PostedLedgerTransaction> {
    try {
      return await this.postTransactionInner(input);
    } catch (error) {
      throw mapLedgerDomainError(error) ?? error;
    }
  }

  async getTransaction(
    organizationId: string,
    transactionId: string,
  ): Promise<PostedLedgerTransaction> {
    const transaction = await this.databaseService.getClient().ledgerTransaction.findFirst({
      where: { id: transactionId, organizationId },
      include: { entries: { orderBy: { createdAt: 'asc' } } },
    });
    if (transaction === null) {
      throw new LedgerTransactionNotFoundException();
    }
    return transaction;
  }

  async listTransactions(query: ListLedgerTransactionsQuery): Promise<LedgerTransactionListResult> {
    const limit = boundedLimit(query.limit);
    const accountFilter =
      query.accountId === undefined
        ? {}
        : { entries: { some: { ledgerAccountId: query.accountId } } };
    const items = await this.databaseService.getClient().ledgerTransaction.findMany({
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

  async getAccountBalance(organizationId: string, accountId: string): Promise<LedgerBalanceJSON> {
    const account = await this.databaseService.getClient().ledgerAccount.findFirst({
      where: { id: accountId, organizationId },
    });
    if (account === null) {
      throw new LedgerAccountNotFoundException();
    }

    const totals = await this.databaseService.getClient().$queryRaw<
      Array<{ debit_total: bigint; credit_total: bigint }>
    >`
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

  private async postTransactionInner(
    input: PostLedgerTransactionInput,
  ): Promise<PostedLedgerTransaction> {
    const { keyHash } = parseApiIdempotencyKey(input.idempotencyKey);
    const metadata = assertSafeLedgerMetadata(input.metadata ?? {});
    const canonical = canonicalizeLedgerPosting({
      organizationId: input.organizationId,
      transactionType: input.transactionType,
      currency: canonicalizeCurrencyCode(canonicalizeLedgerCurrency(input.currency)),
      entries: input.entries,
      metadata,
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.reversesLedgerTransactionId !== undefined
        ? { reversesLedgerTransactionId: input.reversesLedgerTransactionId }
        : {}),
    });
    if (canonical.organizationId.length === 0) {
      throw new LedgerError(
        LEDGER_ERROR_CODES.LEDGER_CROSS_TENANT_ACCOUNT,
        'Ledger organizationId is required.',
      );
    }
    const fingerprint = fingerprintFinancialCommand({
      scope: IDEMPOTENCY_SCOPES.LEDGER_TRANSACTION_POST,
      organizationId: canonical.organizationId,
      request: ledgerPostingFingerprintPayload(canonical),
    });

    const existing = await this.idempotency.resolveReplay(this.databaseService.getClient(), {
      organizationId: canonical.organizationId,
      scope: IDEMPOTENCY_SCOPES.LEDGER_TRANSACTION_POST,
      keyHash,
      requestFingerprint: fingerprint,
    });
    if (existing !== undefined) {
      return this.getTransaction(canonical.organizationId, existing.resourceId);
    }

    const db = this.databaseService.getClient();
    try {
      return await db.$transaction(async (tx) => {
        const accountIds = [...new Set(canonical.entries.map((entry) => entry.accountId))];
        const accounts = await tx.ledgerAccount.findMany({
          where: { id: { in: accountIds }, organizationId: canonical.organizationId },
        });
        const byId = new Map(accounts.map((account) => [account.id, account]));
        for (const accountId of accountIds) {
          const account = byId.get(accountId);
          if (account === undefined) {
            const foreign = await tx.ledgerAccount.findFirst({ where: { id: accountId } });
            if (foreign !== null) {
              throw new LedgerError(
                LEDGER_ERROR_CODES.LEDGER_CROSS_TENANT_ACCOUNT,
                'Ledger account belongs to another organization.',
              );
            }
            throw new LedgerError(
              LEDGER_ERROR_CODES.LEDGER_ACCOUNT_NOT_FOUND,
              'Ledger account was not found.',
            );
          }
          if (account.status === LedgerAccountStatus.ARCHIVED) {
            throw new LedgerError(
              LEDGER_ERROR_CODES.LEDGER_ACCOUNT_ARCHIVED,
              'Archived ledger accounts cannot receive new postings.',
            );
          }
          assertSameLedgerCurrency(canonical.currency, account.currency);
        }

        if (canonical.reversesLedgerTransactionId !== null) {
          await this.assertReversal(tx, canonical.organizationId, canonical);
        }

        const created = await tx.ledgerTransaction.create({
          data: {
            organizationId: canonical.organizationId,
            transactionType: canonical.transactionType,
            currency: canonical.currency,
            metadata: canonical.metadata as Prisma.InputJsonValue,
            ...(canonical.referenceType !== null ? { referenceType: canonical.referenceType } : {}),
            ...(canonical.referenceId !== null ? { referenceId: canonical.referenceId } : {}),
            ...(canonical.description !== null ? { description: canonical.description } : {}),
            ...(canonical.reversesLedgerTransactionId !== null
              ? { reversesLedgerTransactionId: canonical.reversesLedgerTransactionId }
              : {}),
            ...(input.postedAt !== undefined ? { postedAt: input.postedAt } : {}),
            entries: {
              create: canonical.entries.map((entry) => ({
                ledgerAccountId: entry.accountId,
                side: entry.side,
                amount: entry.amount,
              })),
            },
          },
          include: { entries: { orderBy: { createdAt: 'asc' } } },
        });

        await this.idempotency.bindCompleted(tx, {
          organizationId: canonical.organizationId,
          scope: IDEMPOTENCY_SCOPES.LEDGER_TRANSACTION_POST,
          keyHash,
          requestFingerprint: fingerprint,
          resourceType: IDEMPOTENCY_RESOURCE_TYPES.LEDGERTRANSACTION,
          resourceId: created.id,
        });

        this.logger.info(
          {
            organizationId: canonical.organizationId,
            ledgerTransactionId: created.id,
            transactionType: created.transactionType,
            currency: created.currency,
            entryCount: created.entries.length,
          },
          'Ledger transaction posted',
        );
        return created;
      });
    } catch (error) {
      if (isIdempotencyUnique(error)) {
        const replay = await this.idempotency.resolveReplay(this.databaseService.getClient(), {
          organizationId: canonical.organizationId,
          scope: IDEMPOTENCY_SCOPES.LEDGER_TRANSACTION_POST,
          keyHash,
          requestFingerprint: fingerprint,
        });
        if (replay !== undefined) {
          return this.getTransaction(canonical.organizationId, replay.resourceId);
        }
        throw new LedgerConcurrencyConflictException();
      }
      throw error;
    }
  }

  private async assertReversal(
    tx: LedgerStore,
    organizationId: string,
    canonical: {
      readonly currency: string;
      readonly reversesLedgerTransactionId: string | null;
    },
  ): Promise<void> {
    if (canonical.reversesLedgerTransactionId === null) {
      return;
    }
    const original = await tx.ledgerTransaction.findFirst({
      where: { id: canonical.reversesLedgerTransactionId, organizationId },
    });
    if (original === null) {
      throw new LedgerError(
        LEDGER_ERROR_CODES.LEDGER_INVALID_REVERSAL,
        'Reversed ledger transaction was not found in this organization.',
      );
    }
    assertSameLedgerCurrency(canonical.currency, original.currency);
  }
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return LEDGER_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.max(1, limit), LEDGER_LIST_MAX_LIMIT);
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
