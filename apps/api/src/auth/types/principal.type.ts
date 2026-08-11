import type { ApiEnvironment } from '@fraterunion-payments/database';

/**
 * The normalized identity of whoever is making a request, after
 * authentication. Deliberately a discriminated union rather than a single
 * "user-shaped" object with optional API-key fields bolted on — a human
 * session and a server-to-server API key are different kinds of principal
 * with different authority models (roles vs. scopes), and this type makes
 * that explicit at every call site that branches on `type`.
 */
export type Principal =
  | {
      readonly type: 'USER';
      readonly userId: string;
      readonly sessionId: string;
      readonly email: string;
    }
  | {
      readonly type: 'API_KEY';
      readonly apiKeyId: string;
      readonly organizationId: string;
      readonly environment: ApiEnvironment;
      readonly scopes: readonly string[];
    };

export type UserPrincipal = Extract<Principal, { type: 'USER' }>;
export type ApiKeyPrincipal = Extract<Principal, { type: 'API_KEY' }>;
