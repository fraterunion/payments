import type { RequestWithId } from '../../common/types/request-with-id.type';
import type { OrganizationContext } from './organization-context.type';
import type { Principal } from './principal.type';

/** A request after an authentication guard has run and attached a `principal`. */
export interface AuthenticatedRequest extends RequestWithId {
  principal: Principal;
}

/** A request after `OrganizationContextGuard` has additionally resolved and attached an `organizationContext`. */
export interface OrganizationScopedRequest extends AuthenticatedRequest {
  organizationContext: OrganizationContext;
}
