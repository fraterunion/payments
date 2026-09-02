import type { PrismaClient } from '@fraterunion-payments/database';
import {
  LEGACY_TEST_SLUG_PREFIXES,
  TEST_EMAIL_DOMAIN,
  TEST_SLUG_PREFIX,
  isProtectedSeedEmail,
  isProtectedSeedSlug,
} from './test-ownership';

/** Orgs/users older than this in the reserved namespace are treated as abandoned. */
const ABANDONED_AFTER_MS = 60 * 60 * 1000;

export type TenantCleanupTarget = {
  readonly organizationIds: readonly string[];
  readonly userIds: readonly string[];
};

/**
 * Test-only cleanup. Production code must never disable audit triggers.
 *
 * Deletes:
 * - explicitly tracked fixture IDs
 * - historical `cust-` e2e slugs (no longer written)
 * - abandoned `fup-test-` / `@fup.test` rows older than one hour
 *
 * Does **not** sweep the entire live namespace — parallel Jest workers share
 * this database and must not delete each other's in-flight fixtures.
 *
 * Order respects RESTRICT FKs: mappings → payment create idempotency →
 * payments → customers → outbox/inbox → API keys → audit (trigger
 * disabled only for this delete) → users → organizations.
 */
export async function deleteTenantsForTests(
  db: PrismaClient,
  organizationIds: readonly string[] = [],
  userIds: readonly string[] = [],
): Promise<void> {
  const targets = await resolveCleanupTargets(db, organizationIds, userIds);
  if (targets.organizationIds.length === 0 && targets.userIds.length === 0) {
    return;
  }

  await deleteAuditLogsForTests(db, targets);

  if (targets.organizationIds.length > 0) {
    const orgFilter = { organizationId: { in: [...targets.organizationIds] } };
    await db.customerProviderMapping.deleteMany({ where: orgFilter });
    await db.paymentCreateIdempotencyKey.deleteMany({ where: orgFilter });
    await db.payment.deleteMany({ where: orgFilter });
    await db.customer.deleteMany({ where: orgFilter });
    await db.outboxEvent.deleteMany({ where: orgFilter });
    await db.inboxEvent.deleteMany({ where: orgFilter });
    await db.apiKey.deleteMany({ where: orgFilter });
  }

  if (targets.userIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: [...targets.userIds] } } });
  }

  if (targets.organizationIds.length > 0) {
    await db.organizationMembership.deleteMany({
      where: { organizationId: { in: [...targets.organizationIds] } },
    });
    await db.organization.deleteMany({
      where: { id: { in: [...targets.organizationIds] } },
    });
  }
}

/**
 * Closes a real-PG Nest suite even when cleanup throws, so a failed
 * teardown cannot leak Prisma pools or HTTP servers into the next process.
 */
export async function teardownRealPgSuite(options: {
  readonly app?: { close: () => Promise<unknown> };
  readonly db?: PrismaClient;
  readonly organizationIds?: readonly string[];
  readonly userIds?: readonly string[];
}): Promise<void> {
  try {
    if (options.db !== undefined) {
      await deleteTenantsForTests(options.db, options.organizationIds ?? [], options.userIds ?? []);
    }
  } finally {
    if (options.app !== undefined) {
      await options.app.close();
    } else if (options.db !== undefined) {
      await options.db.$disconnect();
    }
  }
}

async function resolveCleanupTargets(
  db: PrismaClient,
  organizationIds: readonly string[],
  userIds: readonly string[],
): Promise<TenantCleanupTarget> {
  const abandonedBefore = new Date(Date.now() - ABANDONED_AFTER_MS);

  const orgCandidates = await db.organization.findMany({
    where: {
      OR: [
        ...(organizationIds.length > 0 ? [{ id: { in: [...organizationIds] } }] : []),
        ...LEGACY_TEST_SLUG_PREFIXES.map((prefix) => ({ slug: { startsWith: prefix } })),
        { slug: { startsWith: TEST_SLUG_PREFIX }, createdAt: { lt: abandonedBefore } },
      ],
    },
    select: { id: true, slug: true },
  });

  const organizationIdSet = new Set<string>();
  for (const org of orgCandidates) {
    if (!isProtectedSeedSlug(org.slug)) {
      organizationIdSet.add(org.id);
    }
  }

  const userCandidates = await db.user.findMany({
    where: {
      OR: [
        ...(userIds.length > 0 ? [{ id: { in: [...userIds] } }] : []),
        { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` }, createdAt: { lt: abandonedBefore } },
        ...(organizationIdSet.size > 0
          ? [{ memberships: { some: { organizationId: { in: [...organizationIdSet] } } } }]
          : []),
      ],
    },
    select: { id: true, email: true },
  });

  const userIdSet = new Set<string>();
  for (const user of userCandidates) {
    if (!isProtectedSeedEmail(user.email)) {
      userIdSet.add(user.id);
    }
  }

  return {
    organizationIds: [...organizationIdSet],
    userIds: [...userIdSet],
  };
}

async function deleteAuditLogsForTests(
  db: PrismaClient,
  targets: TenantCleanupTarget,
): Promise<void> {
  if (targets.organizationIds.length === 0 && targets.userIds.length === 0) {
    return;
  }

  let triggerDisabled = false;
  try {
    await db.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER USER`;
    triggerDisabled = true;
    await db.auditLog.deleteMany({
      where: {
        OR: [
          ...(targets.organizationIds.length > 0
            ? [{ organizationId: { in: [...targets.organizationIds] } }]
            : []),
          ...(targets.userIds.length > 0 ? [{ actorUserId: { in: [...targets.userIds] } }] : []),
        ],
      },
    });
  } finally {
    if (triggerDisabled) {
      await db.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER USER`;
    }
  }
}
