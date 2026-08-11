import type { MembershipRole } from '@fraterunion-payments/database';

/**
 * The tenant a request is operating against, resolved by
 * `OrganizationContextGuard` — never trusted directly from client input
 * (see ADR-003). `role` is present only for a human (`USER`) principal's
 * resolved membership; API-key principals are scope-governed, not
 * role-governed, so `role` is absent for them.
 */
export interface OrganizationContext {
  readonly organizationId: string;
  readonly role?: MembershipRole;
}
