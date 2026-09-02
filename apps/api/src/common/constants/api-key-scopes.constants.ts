/**
 * The full vocabulary of scopes an API key may be assigned. New scopes are
 * added here only when the resource they guard actually exists.
 */
export const API_KEY_SCOPES = [
  'organizations:read',
  'api_keys:read',
  'api_keys:write',
  'customers:read',
  'customers:write',
  'payments:read',
  'payments:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const API_KEY_SCOPE_SET: ReadonlySet<string> = new Set(API_KEY_SCOPES);

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return API_KEY_SCOPE_SET.has(value);
}
