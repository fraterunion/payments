import { Injectable } from '@nestjs/common';
import { LedgerAccountStatus, Prisma, type LedgerAccount } from '@fraterunion-payments/database';
import {
  LEDGER_ERROR_CODES,
  LedgerError,
  canonicalizeLedgerAccountCode,
  canonicalizeLedgerAccountName,
  canonicalizeLedgerCurrency,
  asLedgerAccountType,
} from '@fraterunion-payments/ledger-core';
import { canonicalizeCurrencyCode } from '@fraterunion-payments/payment-core';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, type AuditActor } from '../audit/audit.types';
import type { RequestContext } from '../auth/types/request-context.type';
import { DatabaseService } from '../database/database.service';
import {
  LedgerAccountNotFoundException,
  isLedgerAccountCodeUnique,
  mapLedgerDomainError,
} from './ledger.exceptions';
import {
  LEDGER_LIST_DEFAULT_LIMIT,
  LEDGER_LIST_MAX_LIMIT,
  type CreateLedgerAccountInput,
  type LedgerAccountListCursor,
  type ListLedgerAccountsQuery,
} from './ledger.types';

export type LedgerAccountListResult = {
  readonly items: readonly LedgerAccount[];
  readonly nextCursor: LedgerAccountListCursor | undefined;
};

@Injectable()
export class LedgerAccountsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LedgerAccountsService.name);
  }

  async create(
    input: CreateLedgerAccountInput,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<LedgerAccount> {
    try {
      const code = canonicalizeLedgerAccountCode(input.code);
      const name = canonicalizeLedgerAccountName(input.name);
      const type = asLedgerAccountType(input.type);
      const currency = canonicalizeCurrencyCode(canonicalizeLedgerCurrency(input.currency));
      const db = this.databaseService.getClient();
      return await db.$transaction(async (tx) => {
        const created = await tx.ledgerAccount.create({
          data: {
            organizationId: input.organizationId,
            code,
            name,
            type,
            currency,
            status: LedgerAccountStatus.ACTIVE,
          },
        });
        await this.auditService.write(tx, {
          organizationId: input.organizationId,
          actor,
          action: AUDIT_ACTIONS.LEDGER_ACCOUNT_CREATED,
          resource: { type: AUDIT_RESOURCE_TYPES.LEDGER_ACCOUNT, id: created.id },
          metadata: {
            code: created.code,
            type: created.type,
            currency: created.currency,
          },
          ...(requestContext !== undefined ? { requestContext } : {}),
        });
        this.logger.info(
          { organizationId: input.organizationId, ledgerAccountId: created.id, code },
          'Ledger account created',
        );
        return created;
      });
    } catch (error) {
      if (isLedgerAccountCodeUnique(error)) {
        throw (
          mapLedgerDomainError(
            new LedgerError(
              LEDGER_ERROR_CODES.LEDGER_ACCOUNT_CODE_CONFLICT,
              'A ledger account with this code already exists.',
            ),
          ) ?? error
        );
      }
      throw mapLedgerDomainError(error) ?? error;
    }
  }

  async get(organizationId: string, accountId: string): Promise<LedgerAccount> {
    const account = await this.databaseService.getClient().ledgerAccount.findFirst({
      where: { id: accountId, organizationId },
    });
    if (account === null) {
      throw new LedgerAccountNotFoundException();
    }
    return account;
  }

  async list(query: ListLedgerAccountsQuery): Promise<LedgerAccountListResult> {
    const limit = boundedLimit(query.limit);
    const items = await this.databaseService.getClient().ledgerAccount.findMany({
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

  async archive(
    organizationId: string,
    accountId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<LedgerAccount> {
    const db = this.databaseService.getClient();
    return db.$transaction(async (tx) => {
      const existing = await tx.ledgerAccount.findFirst({
        where: { id: accountId, organizationId },
      });
      if (existing === null) {
        throw new LedgerAccountNotFoundException();
      }
      if (existing.status === LedgerAccountStatus.ARCHIVED) {
        return existing;
      }
      const archived = await tx.ledgerAccount.update({
        where: { id: existing.id },
        data: {
          status: LedgerAccountStatus.ARCHIVED,
          archivedAt: new Date(),
        },
      });
      await this.auditService.write(tx, {
        organizationId,
        actor,
        action: AUDIT_ACTIONS.LEDGER_ACCOUNT_ARCHIVED,
        resource: { type: AUDIT_RESOURCE_TYPES.LEDGER_ACCOUNT, id: archived.id },
        metadata: { code: archived.code },
        ...(requestContext !== undefined ? { requestContext } : {}),
      });
      return archived;
    });
  }
}

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
