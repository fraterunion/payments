import { Injectable } from '@nestjs/common';
import type { Prisma } from '@fraterunion-payments/database';
import { PinoLogger } from 'nestjs-pino';
import { DatabaseService } from '../database/database.service';
import type { DatabaseClient } from '../database/database.types';
import type { AuditActor, RecordAuditEventInput } from './audit.types';

type AuditWriteClient = DatabaseClient | Prisma.TransactionClient;

function actorFields(actor: AuditActor): { actorUserId?: string; actorApiKeyId?: string } {
  switch (actor.type) {
    case 'user':
      return { actorUserId: actor.userId };
    case 'api_key':
      return { actorApiKeyId: actor.apiKeyId };
    case 'system':
      return {};
  }
}

/**
 * Append-only recorder for security-sensitive events. Every call requires
 * an explicit organization — there is no "log without a tenant" path,
 * matching `AuditLog.organizationId` being non-nullable in the schema (see
 * ADR-003). `record` never catches or swallows a write failure: on the
 * default path (no `client` passed) a failure propagates as a normal
 * rejected promise; callers making a mutation and its audit record atomic
 * pass the transaction's own client so both commit or roll back together.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuditService.name);
  }

  async record(input: RecordAuditEventInput, client?: AuditWriteClient): Promise<void> {
    const db = client ?? this.databaseService.getClient();
    const { actorUserId, actorApiKeyId } = actorFields(input.actor);

    await db.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: input.action,
        resourceType: input.resourceType,
        metadata: input.metadata ?? {},
        ...(actorUserId !== undefined ? { actorUserId } : {}),
        ...(actorApiKeyId !== undefined ? { actorApiKeyId } : {}),
        ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
        ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
        ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
      },
    });

    this.logger.info(
      {
        organizationId: input.organizationId,
        action: input.action,
        resourceType: input.resourceType,
      },
      'Audit event recorded',
    );
  }
}
