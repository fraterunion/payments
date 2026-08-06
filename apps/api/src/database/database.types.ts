import type { PrismaClient } from '@fraterunion-payments/database';

/**
 * Alias for the injected client type, so consumers depend on this module's
 * own type rather than reaching into `@fraterunion-payments/database`
 * directly everywhere.
 */
export type DatabaseClient = PrismaClient;
