import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client/index.js';

export interface CreatePrismaClientOptions {
  /** PostgreSQL connection string, e.g. the value of `DATABASE_URL`. */
  readonly connectionString: string;
}

/**
 * Creates a new, independent PrismaClient instance backed by the PostgreSQL
 * driver adapter. Does not connect to the database and is not a singleton —
 * connection lifecycle (when to connect/disconnect) is owned by the
 * consuming application, not this package.
 */
export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString: options.connectionString });
  return new PrismaClient({ adapter });
}
