/**
 * The full vocabulary of scopes an API key may be assigned. Deliberately
 * small: this commit implements no payment, customer, or provider
 * functionality, so no scope resembling `payments:*` exists yet — adding
 * one now, unassignable and unchecked anywhere, would misrepresent it as
 * implemented. New scopes are added here only when the resource they guard
 * actually exists.
 */
export const API_KEY_SCOPES = ['organizations:read', 'api_keys:read', 'api_keys:write'] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const API_KEY_SCOPE_SET: ReadonlySet<string> = new Set(API_KEY_SCOPES);

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return API_KEY_SCOPE_SET.has(value);
}
