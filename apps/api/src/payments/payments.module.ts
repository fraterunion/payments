import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { PaymentsController } from './payments.controller';
import { PaymentProviderExecutionService } from './payment-provider-execution.service';
import { PaymentsService } from './payments.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, IdempotencyModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentProviderExecutionService],
  exports: [PaymentsService, PaymentProviderExecutionService],
})
export class PaymentsModule {}
