import type { MembershipRole, UserStatus } from '@fraterunion-payments/database';

export interface MeMembershipSummary {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly role: MembershipRole;
}

export interface MeResult {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
    readonly status: UserStatus;
    readonly createdAt: Date;
  };
  readonly memberships: readonly MeMembershipSummary[];
  readonly session: {
    readonly id: string;
    readonly expiresAt: Date;
  };
}
