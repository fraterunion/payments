import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { OrganizationScopedRequest } from '../types/authenticated-request.type';
import type { OrganizationContext } from '../types/organization-context.type';

/** Injects the resolved organization context attached by `OrganizationContextGuard`. Only safe on routes guarded by it. */
export const CurrentOrganizationContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrganizationContext => {
    const request = context.switchToHttp().getRequest<OrganizationScopedRequest>();
    return request.organizationContext;
  },
);
