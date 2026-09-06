import type { InboxEvent, PrismaClient } from '@fraterunion-payments/database';
import type { InboxEventHandler } from '@fraterunion-payments/events';
import {
  processStripeInboxEvent,
  type StripeInboxAuditWrite,
} from '@fraterunion-payments/payment-application';

export function createStripeFinancialInboxHandler(options: {
  readonly database: PrismaClient;
  readonly writeAudit: StripeInboxAuditWrite;
}): InboxEventHandler {
  return async (event: InboxEvent) =>
    processStripeInboxEvent(options.database, event, {
      writeAudit: options.writeAudit,
    });
}
