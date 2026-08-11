import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';
import type { Principal } from '../types/principal.type';

/** Injects the authenticated principal attached by an auth guard. Only safe on routes guarded by one — see the guards in `apps/api/src/auth/guards/`. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.principal;
  },
);
