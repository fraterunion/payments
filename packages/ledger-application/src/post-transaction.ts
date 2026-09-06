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
  ledgerPostingFingerprintPayload,
} from '@fraterunion-payments/ledger-core';
import { canonicalizeCurrencyCode } from '@fraterunion-payments/payment-core';
import { LEDGER_APPLICATION_ERROR_CODES, LedgerApplicationError } from './errors.js';
import {
  bindLedgerPostCompleted,
  fingerprintLedgerPosting,
  hashLedgerIdempotencyKey,
  isLedgerIdempotencyUnique,
  resolveLedgerPostReplay,
} from './idempotency.js';
import { assertSafeLedgerMetadata } from './metadata.js';
import type { LedgerStore, PostLedgerTransactionInput } from './types.js';

export type PostedLedgerTransaction = LedgerTransaction & {
  readonly entries: readonly LedgerEntry[];
};

export async function getLedgerTransaction(
  client: LedgerStore,
  organizationId: string,
  transactionId: string,
): Promise<PostedLedgerTransaction> {
  const transaction = await client.ledgerTransaction.findFirst({
    where: { id: transactionId, organizationId },
    include: { entries: { orderBy: { createdAt: 'asc' } } },
  });
  if (transaction === null) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_TRANSACTION_NOT_FOUND,
      'Ledger transaction was not found.',
    );
  }
  return transaction;
}

/**
 * Posts a balanced journal using the provided Prisma client. Does not open
 * its own `$transaction`. Callers that need atomicity with other writes
 * must pass an existing transaction client.
 *
 * `postedAt` is not part of the idempotency fingerprint. Defaulting it
 * inside PostgreSQL keeps retries from conflicting when wall-clock time
 * changes.
 */
export async function postLedgerTransaction(
  client: LedgerStore,
  input: PostLedgerTransactionInput,
): Promise<PostedLedgerTransaction> {
  const keyHash = hashLedgerIdempotencyKey(input.idempotencyKey);
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(87236404, hashtext(${keyHash}))
  `;
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
  const fingerprint = fingerprintLedgerPosting({
    organizationId: canonical.organizationId,
    request: ledgerPostingFingerprintPayload(canonical),
  });

  const existing = await resolveLedgerPostReplay(client, {
    organizationId: canonical.organizationId,
    keyHash,
    requestFingerprint: fingerprint,
  });
  if (existing !== undefined) {
    return getLedgerTransaction(client, canonical.organizationId, existing.resourceId);
  }

  try {
    const accountIds = [...new Set(canonical.entries.map((entry) => entry.accountId))];
    const accounts = await client.ledgerAccount.findMany({
      where: { id: { in: accountIds }, organizationId: canonical.organizationId },
    });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    for (const accountId of accountIds) {
      const account = byId.get(accountId);
      if (account === undefined) {
        const foreign = await client.ledgerAccount.findFirst({ where: { id: accountId } });
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
      const original = await client.ledgerTransaction.findFirst({
        where: {
          id: canonical.reversesLedgerTransactionId,
          organizationId: canonical.organizationId,
        },
      });
      if (original === null) {
        throw new LedgerError(
          LEDGER_ERROR_CODES.LEDGER_INVALID_REVERSAL,
          'Reversed ledger transaction was not found in this organization.',
        );
      }
      assertSameLedgerCurrency(canonical.currency, original.currency);
    }

    const created = await client.ledgerTransaction.create({
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

    await bindLedgerPostCompleted(client, {
      organizationId: canonical.organizationId,
      keyHash,
      requestFingerprint: fingerprint,
      resourceId: created.id,
    });
    return created;
  } catch (error) {
    if (isLedgerIdempotencyUnique(error)) {
      const replay = await resolveLedgerPostReplay(client, {
        organizationId: canonical.organizationId,
        keyHash,
        requestFingerprint: fingerprint,
      });
      if (replay !== undefined) {
        return getLedgerTransaction(client, canonical.organizationId, replay.resourceId);
      }
      throw new LedgerApplicationError(
        LEDGER_APPLICATION_ERROR_CODES.LEDGER_CONCURRENCY_CONFLICT,
        'The ledger command could not be completed because of a concurrent change.',
      );
    }
    throw error;
  }
}
