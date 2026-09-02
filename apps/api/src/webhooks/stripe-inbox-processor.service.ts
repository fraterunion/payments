import { Injectable } from '@nestjs/common';
import type { InboxEvent } from '@fraterunion-payments/database';
import {
  processStripeInboxEvent,
  type ProcessStripeInboxResult,
} from '@fraterunion-payments/events';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class StripeInboxProcessorService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StripeInboxProcessorService.name);
  }

  async process(event: InboxEvent): Promise<ProcessStripeInboxResult> {
    const result = await processStripeInboxEvent(this.databaseService.getClient(), event, {
      writeAudit: async (client, input) => {
        await this.auditService.write(client, {
          organizationId: input.organizationId,
          actor: { type: 'SYSTEM' },
          action: input.action,
          resource: { type: input.resourceType, id: input.resourceId },
          metadata: input.metadata,
        });
      },
    });
    this.logger.info(
      {
        inboxEventId: event.id,
        sourceEventId: event.externalEventId,
        provider: 'stripe',
        organizationId: result.event.organizationId,
        processingOutcome: result.outcome,
      },
      'Stripe inbox event processed',
    );
    return result;
  }
}
