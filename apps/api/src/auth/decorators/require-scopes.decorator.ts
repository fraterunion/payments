import { SetMetadata } from '@nestjs/common';
import type { ApiKeyScope } from '../../common/constants/api-key-scopes.constants';

export const REQUIRE_SCOPES_KEY = 'fraterunion:requireScopes';

/** Declares the scopes an API-key principal must hold to call a route. No effect on human (`USER`) principals — see `RequireScopesGuard`. */
export const RequireScopes = (...scopes: ApiKeyScope[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_SCOPES_KEY, scopes);
