import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CustomerProviderMappingsService } from './customer-provider-mappings.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerProviderMappingsService],
  exports: [CustomersService, CustomerProviderMappingsService],
})
export class CustomersModule {}
