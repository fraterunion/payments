import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Not global: only `HealthModule` needs `DatabaseService` in this commit.
 * Future modules that need it import this module explicitly — Nest still
 * resolves `DatabaseService` as a single shared instance regardless of how
 * many modules import `DatabaseModule`.
 */
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
