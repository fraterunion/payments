import { HttpStatus, Injectable } from '@nestjs/common';
import type { PaymentProviderExecution } from '@fraterunion-payments/database';
import { Prisma } from '@fraterunion-payments/database';
import {
  asPaymentProviderCode,
  createProviderPaymentReference,
} from '@fraterunion-payments/provider-contracts';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, type AuditActor } from '../audit/audit.types';
import { ERROR_CODES } from '../common/constants/error-codes.constants';
import { AppException } from '../common/exceptions/app.exception';
import { normalizeProviderAccountScope } from '../customers/provider-account-scope';
import { DatabaseService } from '../database/database.service';
import { PaymentNotFoundException } from './payment.exceptions';

export class ProviderExecutionAlreadyBoundException extends AppException {
  constructor() {
    super(
      ERROR_CODES.PROVIDER_EXECUTION_ALREADY_BOUND,
      'This provider payment object is already bound to a payment.',
      HttpStatus.CONFLICT,
    );
  }
}

export type CreatePaymentProviderExecutionInput = {
  readonly organizationId: string;
  readonly paymentId: string;
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly providerAccountReference?: string;
};

@Injectable()
export class PaymentProviderExecutionService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PaymentProviderExecutionService.name);
  }

  async create(
    input: CreatePaymentProviderExecutionInput,
    actor: AuditActor,
  ): Promise<PaymentProviderExecution> {
    const provider = asPaymentProviderCode(input.provider);
    const providerPaymentId = createProviderPaymentReference({
      provider,
      id: input.providerPaymentId,
    }).id;
    const account = normalizeProviderAccountScope(input.providerAccountReference);
    const db = this.databaseService.getClient();

    try {
      return await db.$transaction(async (tx) => {
        const payment = await tx.payment.findFirst({
          where: { id: input.paymentId, organizationId: input.organizationId },
        });
        if (payment === null) {
          throw new PaymentNotFoundException();
        }

        const created = await tx.paymentProviderExecution.create({
          data: {
            organizationId: input.organizationId,
            paymentId: payment.id,
            provider,
            providerPaymentId,
            providerAccountScope: account.providerAccountScope,
            ...(account.providerAccountReference !== undefined
              ? { providerAccountReference: account.providerAccountReference }
              : {}),
          },
        });

        await this.auditService.write(tx, {
          organizationId: input.organizationId,
          actor,
          action: AUDIT_ACTIONS.PAYMENT_PROVIDER_EXECUTION_CREATED,
          resource: {
            type: AUDIT_RESOURCE_TYPES.PAYMENT_PROVIDER_EXECUTION,
            id: created.id,
          },
          metadata: {
            paymentId: payment.id,
            provider: created.provider,
            providerAccountPresent: created.providerAccountReference !== null,
          },
        });
        this.logger.info(
          {
            organizationId: input.organizationId,
            paymentId: payment.id,
            executionId: created.id,
            provider: created.provider,
          },
          'Payment provider execution created',
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
