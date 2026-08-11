import { Injectable } from '@nestjs/common';
import type { OrganizationMembership, Prisma } from '@fraterunion-payments/database';
import { DatabaseService } from '../../database/database.service';
import type { DatabaseClient } from '../../database/database.types';

type QueryClient = DatabaseClient | Prisma.TransactionClient;

/**
 * Shared membership lookups used across registration, login/session
 * auditing, and organization-context resolution — kept in one place so
 * "how do we find a user's membership" has a single implementation.
 */
@Injectable()
export class OrganizationMembershipService {
  constructor(private readonly databaseService: DatabaseService) {}

  async findMembership(
    userId: string,
    organizationId: string,
    client?: QueryClient,
  ): Promise<OrganizationMembership | null> {
    const db = client ?? this.databaseService.getClient();
    return db.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
  }

  /**
   * Returns the user's membership only when it is unambiguous — exactly one
   * organization. Returns `null` for zero or multiple memberships. This
   * commit has no invitation feature, so every registered user has exactly
   * one membership (the organization created at registration) and this is
   * unambiguous in practice; the multi-membership case is handled here only
   * so a future multi-org feature doesn't silently misattribute data, not
   * because it can occur today. See
   * docs/architecture/authentication-and-access-control.md.
   */
  async findSoleMembership(
    userId: string,
    client?: QueryClient,
  ): Promise<OrganizationMembership | null> {
    const db = client ?? this.databaseService.getClient();
    const memberships = await db.organizationMembership.findMany({ where: { userId }, take: 2 });
    return memberships.length === 1 ? (memberships[0] ?? null) : null;
  }
}
