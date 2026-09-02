import { Module } from '@nestjs/common';
import { InboxService } from '@fraterunion-payments/events';
import { DatabaseModule } from '../database/database.module';
import { StripeWebhookIngestionService } from './stripe-webhook.service';
import { StripeWebhooksController } from './stripe-webhooks.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [StripeWebhooksController],
  providers: [
    {
      provide: InboxService,
      useFactory: (): InboxService => new InboxService(),
    },
    StripeWebhookIngestionService,
  ],
})
export class StripeWebhooksModule {}
