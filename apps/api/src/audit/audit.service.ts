import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma } from '@fraterunion-payments/database';
import { PinoLogger } from 'nestjs-pino';
import type { RequestContext } from '../auth/types/request-context.type';
import type { DatabaseClient } from '../database/database.types';
import { assertSafeAuditMetadata } from './audit-metadata';
import {
  AUDIT_LIST_DEFAULT_LIMIT,
  AUDIT_LIST_MAX_LIMIT,
  AUDIT_USER_AGENT_MAX_LENGTH,
  type AuditActor,
  type AuditListQuery,
  type AuditListResult,
  type WriteAuditInput,
} from './audit.types';

export type AuditWriteClient = DatabaseClient | Prisma.TransactionClient;

function actorColumns(actor: AuditActor): { actorUserId?: string; actorApiKeyId?: string } {
  switch (actor.type) {
    case 'USER':
      return { actorUserId: actor.userId };
    case 'API_KEY':
      return { actorApiKeyId: actor.apiKeyId };
    case 'SYSTEM':
      return {};
  }
}

function boundedRequestContext(context: RequestContext | undefined): {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
} {
  if (context === undefined) {
    return {};
  }
  const userAgent =
    context.userAgent === undefined
      ? undefined
      : context.userAgent.slice(0, AUDIT_USER_AGENT_MAX_LENGTH);
  return {
    ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
    ...(context.ipAddress !== undefined ? { ipAddress: context.ipAddress } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
  };
}

/**
 * Append-only security audit. `write` always uses the supplied Prisma
 * client or transaction — it never opens a nested transaction. There is
 * no update or delete API. Every row requires an explicit organizationId
 * (tenant-bound; no platform audit path in this commit).
 */
@Injectable()
export class AuditService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AuditService.name);
  }

  async write(client: AuditWriteClient, input: WriteAuditInput): Promise<AuditLog> {
    if (input.organizationId.trim().length === 0) {
      throw new TypeError('organizationId is required.');
    }
    if (input.action.trim().length === 0) {
      throw new TypeError('action must be non-empty.');
    }
    if (input.resource.type.trim().length === 0) {
      throw new TypeError('resource.type must be non-empty.');
    }

    const metadata = assertSafeAuditMetadata(input.metadata ?? {});
    const { actorUserId, actorApiKeyId } = actorColumns(input.actor);
    const request = boundedRequestContext(input.requestContext);

    const created = await client.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: input.action,
        resourceType: input.resource.type,
        metadata: metadata as Prisma.InputJsonValue,
        ...(actorUserId !== undefined ? { actorUserId } : {}),
        ...(actorApiKeyId !== undefined ? { actorApiKeyId } : {}),
        ...(input.resource.id !== undefined ? { resourceId: input.resource.id } : {}),
        ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
        ...(request.ipAddress !== undefined ? { ipAddress: request.ipAddress } : {}),
        ...(request.userAgent !== undefined ? { userAgent: request.userAgent } : {}),
      },
    });

    this.logger.info(
      {
        organizationId: input.organizationId,
        action: input.action,
        resourceType: input.resource.type,
      },
      'Audit event recorded',
    );

    return created;
  }

  /**
   * Tenant-scoped read. `organizationId` is mandatory; results never
   * include another organization's rows. Newest first, cursor `(createdAt, id)`.
   */
  async list(client: AuditWriteClient, query: AuditListQuery): Promise<AuditListResult> {
    if (query.organizationId.trim().length === 0) {
      throw new TypeError('organizationId is required.');
    }

    const limit = Math.min(
      Math.max(query.limit ?? AUDIT_LIST_DEFAULT_LIMIT, 1),
      AUDIT_LIST_MAX_LIMIT,
    );

    const items = await client.auditLog.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.action !== undefined ? { action: query.action } : {}),
        ...(query.resourceType !== undefined ? { resourceType: query.resourceType } : {}),
        ...(query.resourceId !== undefined ? { resourceId: query.resourceId } : {}),
        ...(query.actorUserId !== undefined ? { actorUserId: query.actorUserId } : {}),
        ...(query.actorApiKeyId !== undefined ? { actorApiKeyId: query.actorApiKeyId } : {}),
        ...(query.requestId !== undefined ? { requestId: query.requestId } : {}),
        ...createdAtWhere(query),
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
}

function createdAtWhere(query: AuditListQuery): Prisma.AuditLogWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (query.createdAtFrom !== undefined) {
    createdAt.gte = query.createdAtFrom;
  }
  if (query.createdAtTo !== undefined) {
    createdAt.lte = query.createdAtTo;
  }
  if (query.cursor !== undefined) {
    createdAt.lte = query.cursor.createdAt;
  }

  const hasCreatedAt = Object.keys(createdAt).length > 0;
  if (query.cursor === undefined) {
    return hasCreatedAt ? { createdAt } : {};
  }

  return {
    AND: [
      hasCreatedAt ? { createdAt } : {},
      {
        OR: [
          { createdAt: { lt: query.cursor.createdAt } },
          { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
        ],
      },
    ],
  };
}
