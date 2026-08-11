import type { ApiEnvironment } from '@fraterunion-payments/database';

export interface AuthenticatedApiKey {
  readonly apiKeyId: string;
  readonly organizationId: string;
  readonly environment: ApiEnvironment;
  readonly scopes: readonly string[];
}
