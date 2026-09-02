import { HttpStatus, Injectable } from '@nestjs/common';
import type { RefundProviderExecution } from '@fraterunion-payments/database';
import { Prisma } from '@fraterunion-payments/database';
import {
  asPaymentProviderCode,
  createProviderRefundReference,
} from '@fraterunion-payments/provider-contracts';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, type AuditActor } from '../audit/audit.types';
import { ERROR_CODES } from '../common/constants/error-codes.constants';
import { AppException } from '../common/exceptions/app.exception';
import { DatabaseService } from '../database/database.service';
import { ProviderExecutionAlreadyBoundException } from '../payments/payment-provider-execution.service';
import { RefundNotFoundException } from './refund.exceptions';

export class ProviderExecutionNotFoundException extends AppException {
  constructor() {
    super(
      ERROR_CODES.PROVIDER_EXECUTION_NOT_FOUND,
      'Payment provider execution was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ProviderExecutionPaymentMismatchException extends AppException {
  constructor() {
    super(
      ERROR_CODES.PROVIDER_EXECUTION_PAYMENT_MISMATCH,
      'Refund provider execution must belong to the same payment as the payment execution.',
      HttpStatus.CONFLICT,
    );
  }
}

export type CreateRefundProviderExecutionInput = {
  readonly organizationId: string;
  readonly refundId: string;
  readonly paymentProviderExecutionId: string;
  readonly providerRefundId: string;
};

@Injectable()
export class RefundProviderExecutionService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RefundProviderExecutionService.name);
  }

  async create(
    input: CreateRefundProviderExecutionInput,
    actor: AuditActor,
  ): Promise<RefundProviderExecution> {
    const db = this.databaseService.getClient();
    try {
      return await db.$transaction(async (tx) => {
        const refund = await tx.refund.findFirst({
          where: { id: input.refundId, organizationId: input.organizationId },
        });
        if (refund === null) {
          throw new RefundNotFoundException();
        }
        const paymentExecution = await tx.paymentProviderExecution.findFirst({
          where: {
            id: input.paymentProviderExecutionId,
            organizationId: input.organizationId,
          },
        });
        if (paymentExecution === null) {
          throw new ProviderExecutionNotFoundException();
        }
        if (paymentExecution.paymentId !== refund.paymentId) {
          throw new ProviderExecutionPaymentMismatchException();
        }

        const provider = asPaymentProviderCode(paymentExecution.provider);
        const providerRefundId = createProviderRefundReference({
          provider,
          id: input.providerRefundId,
        }).id;

        const created = await tx.refundProviderExecution.create({
          data: {
            organizationId: input.organizationId,
            refundId: refund.id,
            paymentId: refund.paymentId,
            paymentProviderExecutionId: paymentExecution.id,
            provider,
            providerRefundId,
            providerAccountScope: paymentExecution.providerAccountScope,
            ...(paymentExecution.providerAccountReference !== null
              ? { providerAccountReference: paymentExecution.providerAccountReference }
              : {}),
          },
        });

        await this.auditService.write(tx, {
          organizationId: input.organizationId,
          actor,
          action: AUDIT_ACTIONS.REFUND_PROVIDER_EXECUTION_CREATED,
          resource: {
            type: AUDIT_RESOURCE_TYPES.REFUND_PROVIDER_EXECUTION,
            id: created.id,
          },
          metadata: {
            refundId: refund.id,
            paymentId: refund.paymentId,
            paymentProviderExecutionId: paymentExecution.id,
            provider: created.provider,
          },
        });
        this.logger.info(
          {
            organizationId: input.organizationId,
            refundId: refund.id,
            executionId: created.id,
            provider: created.provider,
          },
          'Refund provider execution created',
        );
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ProviderExecutionAlreadyBoundException();
      }
      throw error;
    }
  }
}
