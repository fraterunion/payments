import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '@fraterunion-payments/database';

export const REQUIRE_ROLES_KEY = 'fraterunion:requireRoles';

/**
 * Declares the explicit set of organization roles allowed to call a route.
 * No numeric hierarchy — `@RequireRoles(OWNER, ADMIN)` lists exactly the
 * roles permitted, so reviewing a route's access never requires reasoning
 * about an implicit ordering.
 */
export const RequireRoles = (...roles: MembershipRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ROLES_KEY, roles);
