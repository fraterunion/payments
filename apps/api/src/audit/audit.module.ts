import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditService } from './audit.service';

/**
 * Not global, same rationale as `DatabaseModule`: only modules that
 * actually record audit events import this explicitly.
 */
@Module({
  imports: [DatabaseModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
