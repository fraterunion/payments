import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { describe } from 'vitest';
import { createPrismaClient, type PrismaClient } from '@fraterunion-payments/database';

if (process.env['DATABASE_URL'] === undefined) {
  for (const candidate of [
    resolve(process.cwd(), '../../packages/database/.env'),
    resolve(process.cwd(), 'packages/database/.env'),
  ]) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      break;
    }
  }
}

export const databaseUrl = process.env['DATABASE_URL'];

export function describePostgres(name: string, factory: () => void): void {
  const suite = databaseUrl === undefined ? describe.skip : describe;
  suite(name, factory);
}

export function createTestClient(): PrismaClient {
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL must be set');
  }
  return createPrismaClient({ connectionString: databaseUrl });
}

export async function createTestOrganization(
  db: PrismaClient,
): Promise<{ id: string; slug: string }> {
  const slug = `worker-test-${randomUUID().slice(0, 8)}`;
  const organization = await db.organization.create({
    data: {
      name: `Worker Test ${slug}`,
      slug,
      type: 'BUSINESS',
      status: 'ACTIVE',
      defaultCurrency: 'USD',
      countryCode: 'US',
      timezone: 'America/New_York',
    },
  });
  return { id: organization.id, slug };
}

export async function cleanupOrganizations(
  db: PrismaClient,
  organizationIds: readonly string[],
): Promise<void> {
  if (organizationIds.length === 0) {
    return;
  }
  await db.outboxEvent.deleteMany({ where: { organizationId: { in: [...organizationIds] } } });
  await db.inboxEvent.deleteMany({ where: { organizationId: { in: [...organizationIds] } } });
  await db.organization.deleteMany({ where: { id: { in: [...organizationIds] } } });
}
