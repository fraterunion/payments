/**
 * Local development seed data only. Never run against a production
 * database. Every write is an upsert keyed on a unique field, so running
 * this script repeatedly is safe and does not create duplicates.
 */
import {
  MembershipRole,
  OrganizationStatus,
  OrganizationType,
  UserStatus,
} from '../generated/client/index.js';
import { createPrismaClient } from '../src/client.js';

const DEVELOPMENT_ORGANIZATION = {
  name: 'FraterUnion',
  slug: 'fraterunion',
  type: OrganizationType.INTERNAL,
  status: OrganizationStatus.ACTIVE,
  defaultCurrency: 'USD',
  countryCode: 'US',
  // Tenant timezones are configurable per organization; this is only the
  // seeded default for the internal development organization.
  timezone: 'America/New_York',
} as const;

const DEVELOPMENT_USER = {
  email: 'developer@fraterunion.local',
  displayName: 'FraterUnion Developer',
  status: UserStatus.ACTIVE,
} as const;

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL must be set to run the database seed.');
  }

  const prisma = createPrismaClient({ connectionString: databaseUrl });

  try {
    const organization = await prisma.organization.upsert({
      where: { slug: DEVELOPMENT_ORGANIZATION.slug },
      create: DEVELOPMENT_ORGANIZATION,
      update: DEVELOPMENT_ORGANIZATION,
    });

    const user = await prisma.user.upsert({
      where: { email: DEVELOPMENT_USER.email },
      create: DEVELOPMENT_USER,
      update: DEVELOPMENT_USER,
    });

    await prisma.organizationMembership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      create: {
        organizationId: organization.id,
        userId: user.id,
        role: MembershipRole.OWNER,
      },
      update: {
        role: MembershipRole.OWNER,
      },
    });

    console.log(`Seeded development organization "${organization.slug}" and user "${user.email}".`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Database seed failed:', error);
  process.exitCode = 1;
});
