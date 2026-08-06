import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createPrismaClient } from '@fraterunion-payments/database';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import type { DatabaseClient } from './database.types';

/**
 * Owns the Prisma client's connection lifecycle for the API process.
 * Composition over subclassing `PrismaClient`: the generated client already
 * requires constructing it through a driver adapter (see
 * `@fraterunion-payments/database`), so wrapping it keeps that detail out
 * of every consumer and keeps this service's own public surface small and
 * stable regardless of how the generated client evolves.
 *
 * Constructing the client here does not connect to the database —
 * `createPrismaClient` never does. The connection is opened explicitly in
 * `onModuleInit` and closed in `onModuleDestroy`.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly client: DatabaseClient;

  constructor(
    appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DatabaseService.name);
    this.client = createPrismaClient({ connectionString: appConfig.databaseUrl });
  }

  async onModuleInit(): Promise<void> {
    this.logger.info('Connecting to database...');
    await this.client.$connect();
    // Prisma 7's driver-adapter `$connect()` prepares the adapter but does
    // not itself eagerly open a real connection (the underlying pool
    // connects lazily, per query). A trivial query forces an actual
    // handshake now, so an unreachable database fails startup instead of
    // only surfacing on the first real request.
    await this.client.$queryRaw`SELECT 1`;
    this.logger.info('Database connection established.');
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.info('Disconnecting from database...');
    await this.client.$disconnect();
    this.logger.info('Database connection closed.');
  }

  /** Exposes the client for future modules; this service adds no queries of its own. */
  getClient(): DatabaseClient {
    return this.client;
  }

  /** Lightweight readiness probe used by `/health/ready`. Never throws. */
  async isReady(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error({ err: error }, 'Database readiness check failed.');
      return false;
    }
  }
}
