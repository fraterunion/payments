import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client/index.js';

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

export interface CreatePrismaClientOptions {
  /** PostgreSQL connection string, e.g. the value of `DATABASE_URL`. */
  readonly connectionString: string;
  /**
   * Bounds how long `$connect()` waits for a TCP/auth handshake before
   * failing. Without this, an unreachable host or wrong port hangs
   * indefinitely instead of rejecting — defeating "fail fast on startup".
   * Defaults to 10 seconds.
   */
  readonly connectionTimeoutMillis?: number;
}

/**
 * Creates a new, independent PrismaClient instance backed by the PostgreSQL
 * driver adapter. Does not connect to the database and is not a singleton —
 * connection lifecycle (when to connect/disconnect) is owned by the
 * consuming application, not this package.
 */
export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MS,
  });
  return new PrismaClient({ adapter });
}
