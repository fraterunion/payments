import type { PrismaClient } from '@fraterunion-payments/database';

/**
 * Test-only cleanup. Production code must never disable audit triggers.
 * Local/CI roles own the table and can DISABLE TRIGGER USER so leftover
 * fixture tenants can be removed after immutability is enforced.
 */
export async function deleteTenantsForTests(
  db: PrismaClient,
  organizationIds: readonly string[],
  userIds: readonly string[] = [],
): Promise<void> {
  if (organizationIds.length === 0 && userIds.length === 0) {
    return;
  }

  await db.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER USER`;
  try {
    if (organizationIds.length > 0) {
      await db.auditLog.deleteMany({ where: { organizationId: { in: [...organizationIds] } } });
    }
  } finally {
    await db.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER USER`;
  }

  if (organizationIds.length > 0) {
    await db.apiKey.deleteMany({ where: { organizationId: { in: [...organizationIds] } } });
  }
  if (userIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: [...userIds] } } });
  }
  if (organizationIds.length > 0) {
    await db.organization.deleteMany({ where: { id: { in: [...organizationIds] } } });
  }
}
