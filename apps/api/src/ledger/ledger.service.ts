import { Injectable } from '@nestjs/common';
import type { Prisma } from '@fraterunion-payments/database';
import {
  getLedgerAccountBalance,
  getLedgerTransaction,
  listLedgerTransactions,
  postLedgerTransaction,
  type LedgerStore,
  type PostedLedgerTransaction,
} from '@fraterunion-payments/ledger-application';
import type { LedgerBalanceJSON } from '@fraterunion-payments/ledger-core';
import { PinoLogger } from 'nestjs-pino';
import type { AuditActor } from '../audit/audit.types';
import type { RequestContext } from '../auth/types/request-context.type';
import { DatabaseService } from '../database/database.service';
import type { DatabaseClient } from '../database/database.types';
import { mapLedgerDomainError } from './ledger.exceptions';
import type { ListLedgerTransactionsQuery, PostLedgerTransactionInput } from './ledger.types';

export type { PostedLedgerTransaction };

export type LedgerTransactionListResult = {
  readonly items: readonly PostedLedgerTransaction[];
  readonly nextCursor: { readonly postedAt: Date; readonly id: string } | undefined;
};

@Injectable()
export class LedgerService {
  constructor(
    private readonly databaseService: DatabaseService,
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
      return await this.databaseService
        .getClient()
        .$transaction((tx) => postLedgerTransaction(tx, input));
    } catch (error) {
      throw mapLedgerDomainError(error) ?? error;
    }
  }

  async postTransactionInTransaction(
    tx: LedgerStore,
    input: PostLedgerTransactionInput,
  ): Promise<PostedLedgerTransaction> {
    try {
      return await postLedgerTransaction(tx, input);
    } catch (error) {
      throw mapLedgerDomainError(error) ?? error;
    }
  }

  async getTransaction(
    organizationId: string,
    transactionId: string,
  ): Promise<PostedLedgerTransaction> {
    try {
      return await getLedgerTransaction(this.client(), organizationId, transactionId);
    } catch (error) {
      throw mapLedgerDomainError(error) ?? error;
    }
  }

  async listTransactions(query: ListLedgerTransactionsQuery): Promise<LedgerTransactionListResult> {
    return listLedgerTransactions(this.client(), query);
  }

  async getAccountBalance(organizationId: string, accountId: string): Promise<LedgerBalanceJSON> {
    try {
      return await getLedgerAccountBalance(this.client(), organizationId, accountId);
    } catch (error) {
      throw mapLedgerDomainError(error) ?? error;
    }
  }

  private client(): DatabaseClient | Prisma.TransactionClient {
    return this.databaseService.getClient();
  }
}
