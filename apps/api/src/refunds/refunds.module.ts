import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { PaymentRefundsController, RefundsController } from './refunds.controller';
import { RefundProviderExecutionService } from './refund-provider-execution.service';
import { RefundsService } from './refunds.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, IdempotencyModule],
  controllers: [PaymentRefundsController, RefundsController],
  providers: [RefundsService, RefundProviderExecutionService],
  exports: [RefundsService, RefundProviderExecutionService],
})
export class RefundsModule {}
