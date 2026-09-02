import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@fraterunion-payments/database';
import { deleteTenantsForTests } from './support/immutable-audit-cleanup';
import { resolveDatabaseUrl } from './support/test-database-url';
import { SEED_ORGANIZATION_SLUG, testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping tenant-cleanup integration suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)('Tenant cleanup (real PostgreSQL)', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL must be set');
    }
    const { createPrismaClient } = await import('@fraterunion-payments/database');
    db = createPrismaClient({ connectionString: databaseUrl });
    await db.$connect();
  });

  afterAll(async () => {
    if (db !== undefined) {
      await deleteTenantsForTests(db);
      await db.$disconnect();
    }
  });

  it('deletes an org that still has customers when given its id (RESTRICT-safe order)', async () => {
    const suffix = randomUUID().slice(0, 8);
    const organization = await db.organization.create({
      data: {
        name: `Orphan ${suffix}`,
        slug: testSlug(`orphan-${suffix}`),
        type: 'BUSINESS',
        status: 'ACTIVE',
        defaultCurrency: 'USD',
        countryCode: 'US',
        timezone: 'America/New_York',
      },
    });
    await db.customer.create({
      data: { organizationId: organization.id, name: 'Left behind' },
    });

    await expect(db.organization.delete({ where: { id: organization.id } })).rejects.toThrow();

    await deleteTenantsForTests(db, [organization.id], []);

    expect(await db.organization.findUnique({ where: { id: organization.id } })).toBeNull();
    expect(await db.customer.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(
      await db.organization.findUnique({ where: { slug: SEED_ORGANIZATION_SLUG } }),
    ).not.toBeNull();
  });

  it('sweeps historical cust- leftovers without an explicit id list', async () => {
    const suffix = randomUUID().slice(0, 8);
    const organization = await db.organization.create({
      data: {
        name: `Legacy ${suffix}`,
        slug: `cust-${suffix}`,
        type: 'BUSINESS',
        status: 'ACTIVE',
        defaultCurrency: 'USD',
        countryCode: 'US',
        timezone: 'America/New_York',
      },
    });
    await db.customer.create({
      data: { organizationId: organization.id, name: 'Legacy leftover' },
    });

    await deleteTenantsForTests(db);

    expect(await db.organization.findUnique({ where: { id: organization.id } })).toBeNull();
  });

  it('does not delete the seed developer user', async () => {
    await deleteTenantsForTests(db);
    const seedUser = await db.user.findUnique({
      where: { email: 'developer@fraterunion.local' },
    });
    expect(seedUser).not.toBeNull();
    expect(testEmail('owner-x')).toBe('owner-x@fup.test');
  });
});
