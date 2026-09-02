import { Injectable } from '@nestjs/common';
import type { Customer, Prisma } from '@fraterunion-payments/database';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, type AuditActor } from '../audit/audit.types';
import type { RequestContext } from '../auth/types/request-context.type';
import { DatabaseService } from '../database/database.service';
import { assertSafeCustomerMetadata } from './customer-metadata';
import {
  canonicalizeCustomerEmail,
  canonicalizeCustomerPhone,
  canonicalizeOptionalText,
} from './customer-profile';
import {
  CustomerArchivedException,
  CustomerNotFoundException,
  mapCustomerUniqueViolation,
} from './customer.exceptions';
import {
  CUSTOMER_LIST_DEFAULT_LIMIT,
  CUSTOMER_LIST_MAX_LIMIT,
  type CreateCustomerInput,
  type CustomerListCursor,
  type ListCustomersQuery,
  type UpdateCustomerInput,
} from './customer.types';

export type CustomerListResult = {
  readonly items: readonly Customer[];
  readonly nextCursor: CustomerListCursor | undefined;
};

/**
 * Tenant-scoped customer writes. Organization is always an explicit
 * argument — never inferred. Mutations and audit share one transaction.
 * Domain outbox events are intentionally not emitted yet: the production
 * worker has no customer-domain consumer and would dead-letter them.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CustomersService.name);
  }

  async create(
    input: CreateCustomerInput,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<Customer> {
    const data = this.normalizeCreate(input);
    const db = this.databaseService.getClient();

    try {
      return await db.$transaction(async (tx) => {
        const created = await tx.customer.create({ data });
        await this.auditService.write(tx, {
          organizationId: input.organizationId,
          actor,
          action: AUDIT_ACTIONS.CUSTOMER_CREATED,
          resource: { type: AUDIT_RESOURCE_TYPES.CUSTOMER, id: created.id },
          metadata: safeCustomerAuditMetadata(created),
          ...(requestContext !== undefined ? { requestContext } : {}),
        });
        this.logger.info(
          { organizationId: input.organizationId, customerId: created.id, status: created.status },
          'Customer created',
        );
        return created;
      });
    } catch (error) {
      throw mapCustomerUniqueViolation(error) ?? error;
    }
  }

  async get(organizationId: string, customerId: string): Promise<Customer> {
    const customer = await this.databaseService.getClient().customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (customer === null) {
      throw new CustomerNotFoundException();
    }
    return customer;
  }

  async getByExternalReference(
    organizationId: string,
    externalReference: string,
  ): Promise<Customer | null> {
    return this.databaseService.getClient().customer.findFirst({
      where: { organizationId, externalReference },
    });
  }

  async list(query: ListCustomersQuery): Promise<CustomerListResult> {
    const limit = Math.min(
      Math.max(query.limit ?? CUSTOMER_LIST_DEFAULT_LIMIT, 1),
      CUSTOMER_LIST_MAX_LIMIT,
    );
    const status = query.status ?? 'ACTIVE';
    const items = await this.databaseService.getClient().customer.findMany({
      where: {
        organizationId: query.organizationId,
        status,
        ...searchWhere(query.q),
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

  async update(
    organizationId: string,
    customerId: string,
    input: UpdateCustomerInput,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<Customer> {
    const db = this.databaseService.getClient();
    try {
      return await db.$transaction(async (tx) => {
        const existing = await tx.customer.findFirst({
          where: { id: customerId, organizationId },
        });
        if (existing === null) {
          throw new CustomerNotFoundException();
        }
        if (existing.status === 'ARCHIVED') {
          throw new CustomerArchivedException();
        }
        const updated = await tx.customer.update({
          where: { id: existing.id },
          data: this.normalizeUpdate(input),
        });
        await this.auditService.write(tx, {
          organizationId,
          actor,
          action: AUDIT_ACTIONS.CUSTOMER_UPDATED,
          resource: { type: AUDIT_RESOURCE_TYPES.CUSTOMER, id: updated.id },
          metadata: safeCustomerAuditMetadata(updated),
          ...(requestContext !== undefined ? { requestContext } : {}),
        });
        this.logger.info(
          { organizationId, customerId: updated.id, status: updated.status },
          'Customer updated',
        );
        return updated;
      });
    } catch (error) {
      throw mapCustomerUniqueViolation(error) ?? error;
    }
  }

  async archive(
    organizationId: string,
    customerId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<Customer> {
    const db = this.databaseService.getClient();
    return db.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({
        where: { id: customerId, organizationId },
      });
      if (existing === null) {
        throw new CustomerNotFoundException();
      }
      if (existing.status === 'ARCHIVED') {
        return existing;
      }
      const archived = await tx.customer.update({
        where: { id: existing.id },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
      await this.auditService.write(tx, {
        organizationId,
        actor,
        action: AUDIT_ACTIONS.CUSTOMER_ARCHIVED,
        resource: { type: AUDIT_RESOURCE_TYPES.CUSTOMER, id: archived.id },
        metadata: safeCustomerAuditMetadata(archived),
        ...(requestContext !== undefined ? { requestContext } : {}),
      });
      this.logger.info(
        { organizationId, customerId: archived.id, status: archived.status },
        'Customer archived',
      );
      return archived;
    });
  }

  private normalizeCreate(input: CreateCustomerInput): Prisma.CustomerUncheckedCreateInput {
    return {
      organizationId: input.organizationId,
      type: input.type ?? 'INDIVIDUAL',
      status: 'ACTIVE',
      ...(input.email !== undefined ? { email: canonicalizeCustomerEmail(input.email) } : {}),
      ...(input.name !== undefined
        ? { name: canonicalizeOptionalText(input.name, 'name', 200) }
        : {}),
      ...(input.phone !== undefined ? { phone: canonicalizeCustomerPhone(input.phone) } : {}),
      ...(input.externalReference !== undefined
        ? {
            externalReference: canonicalizeOptionalText(
              input.externalReference,
              'external reference',
              128,
            ),
          }
        : {}),
      ...(input.description !== undefined
        ? { description: canonicalizeOptionalText(input.description, 'description', 2000) }
        : {}),
      metadata: assertSafeCustomerMetadata(input.metadata ?? {}) as Prisma.InputJsonValue,
    };
  }

  private normalizeUpdate(input: UpdateCustomerInput): Prisma.CustomerUpdateInput {
    const data: Prisma.CustomerUpdateInput = {};
    if (input.type !== undefined) {
      data.type = input.type;
    }
    if (input.email !== undefined) {
      data.email = input.email === null ? null : canonicalizeCustomerEmail(input.email);
    }
    if (input.name !== undefined) {
      data.name = input.name === null ? null : canonicalizeOptionalText(input.name, 'name', 200);
    }
    if (input.phone !== undefined) {
      data.phone = input.phone === null ? null : canonicalizeCustomerPhone(input.phone);
    }
    if (input.externalReference !== undefined) {
      data.externalReference =
        input.externalReference === null
          ? null
          : canonicalizeOptionalText(input.externalReference, 'external reference', 128);
    }
    if (input.description !== undefined) {
      data.description =
        input.description === null
          ? null
          : canonicalizeOptionalText(input.description, 'description', 2000);
    }
    if (input.metadata !== undefined) {
      data.metadata = assertSafeCustomerMetadata(input.metadata) as Prisma.InputJsonValue;
    }
    return data;
  }
}

export function safeCustomerAuditMetadata(customer: Customer): Record<string, unknown> {
  return {
    customerType: customer.type,
    status: customer.status,
    hasEmail: customer.email !== null,
    hasPhone: customer.phone !== null,
    externalReferencePresent: customer.externalReference !== null,
  };
}

function searchWhere(q: string | undefined): Prisma.CustomerWhereInput {
  if (q === undefined || q.trim().length === 0) {
    return {};
  }
  const term = q.trim();
  return {
    OR: [
      { name: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { externalReference: { contains: term, mode: 'insensitive' } },
    ],
  };
}

function createdAtCursorWhere(cursor: CustomerListCursor | undefined): Prisma.CustomerWhereInput {
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
