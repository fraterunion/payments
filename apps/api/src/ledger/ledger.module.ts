import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { LedgerAccountsService } from './ledger-accounts.service';
import { LedgerService } from './ledger.service';

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [LedgerAccountsService, LedgerService],
  exports: [LedgerAccountsService, LedgerService],
})
export class LedgerModule {}
