import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/**
 * Not global: only financial modules that bind durable operations import
 * this. The service never opens its own transaction.
 */
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
