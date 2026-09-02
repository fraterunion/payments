import { Injectable } from '@nestjs/common';
import type { CustomerProviderMapping } from '@fraterunion-payments/database';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, type AuditActor } from '../audit/audit.types';
import type { RequestContext } from '../auth/types/request-context.type';
import { DatabaseService } from '../database/database.service';
import { normalizeProviderMappingIdentity } from './provider-account-scope';
import {
  CustomerArchivedException,
  CustomerNotFoundException,
  mapCustomerUniqueViolation,
} from './customer.exceptions';
import type { CreateProviderMappingInput } from './customer.types';

/**
 * Stores provider customer mappings. Does not call any provider SDK.
 * Create/read only — mapping identity is immutable. Mapping creation is
 * service-only (not a public HTTP write) because it will later follow a
 * provider adapter `createCustomer` result.
 */
@Injectable()
export class CustomerProviderMappingsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CustomerProviderMappingsService.name);
  }

  async create(
    input: CreateProviderMappingInput,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<CustomerProviderMapping> {
    const identity = normalizeProviderMappingIdentity(input);
    const db = this.databaseService.getClient();

    try {
      return await db.$transaction(async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { id: input.customerId, organizationId: input.organizationId },
        });
        if (customer === null) {
          throw new CustomerNotFoundException();
        }
        if (customer.status === 'ARCHIVED') {
          throw new CustomerArchivedException();
        }

        const created = await tx.customerProviderMapping.create({
          data: {
            organizationId: input.organizationId,
            customerId: input.customerId,
            provider: identity.provider,
            providerAccountScope: identity.providerAccountScope,
            providerCustomerId: identity.providerCustomerId,
            ...(identity.providerAccountReference !== undefined
              ? { providerAccountReference: identity.providerAccountReference }
              : {}),
          },
        });

        await this.auditService.write(tx, {
          organizationId: input.organizationId,
          actor,
          action: AUDIT_ACTIONS.CUSTOMER_PROVIDER_MAPPING_CREATED,
          resource: { type: AUDIT_RESOURCE_TYPES.CUSTOMER_PROVIDER_MAPPING, id: created.id },
          metadata: {
            customerId: customer.id,
            provider: created.provider,
            providerAccountPresent: created.providerAccountReference !== null,
          },
          ...(requestContext !== undefined ? { requestContext } : {}),
        });
        this.logger.info(
          {
            organizationId: input.organizationId,
            customerId: input.customerId,
            mappingId: created.id,
            provider: created.provider,
          },
          'Customer provider mapping created',
        );
        return created;
      });
    } catch (error) {
      throw mapCustomerUniqueViolation(error) ?? error;
    }
  }

  async get(organizationId: string, mappingId: string): Promise<CustomerProviderMapping> {
    const mapping = await this.databaseService.getClient().customerProviderMapping.findFirst({
      where: { id: mappingId, organizationId },
    });
    if (mapping === null) {
      throw new CustomerNotFoundException();
    }
    return mapping;
  }

  async listForCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<readonly CustomerProviderMapping[]> {
    const customer = await this.databaseService.getClient().customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (customer === null) {
      throw new CustomerNotFoundException();
    }
    return this.databaseService.getClient().customerProviderMapping.findMany({
      where: { organizationId, customerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findByProviderCustomer(input: {
    readonly organizationId: string;
    readonly provider: string;
    readonly providerCustomerId: string;
    readonly providerAccountReference?: string;
  }): Promise<CustomerProviderMapping | null> {
    const identity = normalizeProviderMappingIdentity(input);
    return this.databaseService.getClient().customerProviderMapping.findFirst({
      where: {
        organizationId: input.organizationId,
        provider: identity.provider,
        providerAccountScope: identity.providerAccountScope,
        providerCustomerId: identity.providerCustomerId,
      },
    });
  }
}
