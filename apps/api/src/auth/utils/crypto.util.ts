import { createHash, createHmac, randomBytes } from 'node:crypto';

const OPAQUE_TOKEN_BYTES = 32; // 256 bits

/**
 * A cryptographically random, URL-safe opaque token. Used for both session
 * (refresh) tokens and API-key secrets — 256 bits of randomness from
 * `crypto.randomBytes` is the property both need; neither is a JWT or
 * carries any encoded structure of its own.
 */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

/**
 * Hash used for session/refresh tokens. No pepper: the token itself is
 * already 256 bits of server-generated randomness (never user-chosen, never
 * reused), so this hash exists only for at-rest hygiene (a leaked database
 * row does not itself hand out a usable session), not to add entropy a
 * high-quality random token doesn't already have.
 */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Hash used for API-key secrets, keyed with `API_KEY_HASH_SECRET` as a
 * pepper. Deterministic (unlike Argon2id) by design: it allows looking up
 * an `ApiKey` row directly by `secretHash` — the same globally-unique,
 * direct-lookup pattern this schema already uses for `Session.tokenHash` —
 * without needing a separate salt per row.
 */
export function hashApiKeySecret(secret: string, pepper: string): string {
  return createHmac('sha256', pepper).update(secret).digest('hex');
}
