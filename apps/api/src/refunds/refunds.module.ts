import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { PaymentRefundsController, RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, IdempotencyModule],
  controllers: [PaymentRefundsController, RefundsController],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
