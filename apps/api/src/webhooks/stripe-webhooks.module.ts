import { Module } from '@nestjs/common';
import { InboxService } from '@fraterunion-payments/events';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { StripeInboxProcessorService } from './stripe-inbox-processor.service';
import { StripeWebhookIngestionService } from './stripe-webhook.service';
import { StripeWebhooksController } from './stripe-webhooks.controller';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [StripeWebhooksController],
  providers: [
    {
      provide: InboxService,
      useFactory: (): InboxService => new InboxService(),
    },
    StripeWebhookIngestionService,
    StripeInboxProcessorService,
  ],
  exports: [StripeInboxProcessorService],
})
export class StripeWebhooksModule {}
