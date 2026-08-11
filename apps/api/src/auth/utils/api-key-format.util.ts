import { randomBytes } from 'node:crypto';
import type { ApiEnvironment } from '@fraterunion-payments/database';
import { generateOpaqueToken } from './crypto.util';

/**
 * API-key format: `fup_test_<prefix>_<secret>` / `fup_live_<prefix>_<secret>`.
 *
 * - `fup` is a static, non-secret product marker.
 * - `test`/`live` mirrors `ApiEnvironment`, visible so a key's environment
 *   is identifiable without a database lookup (and so an obviously-TEST
 *   key pasted somewhere is easy to recognize as safe).
 * - `<prefix>` is 12 lowercase hex characters (48 bits), stored in
 *   `ApiKey.keyPrefix` for dashboard/log identification. It is not a
 *   lookup key — see `ParsedApiKey` — so it does not itself need to be
 *   globally unique for authentication to work, only for display.
 * - `<secret>` is a 256-bit random value, base64url-encoded. Never stored;
 *   only `hashApiKeySecret(secret, ...)` is persisted (`ApiKey.secretHash`).
 *
 * `<prefix>` is fixed-length and hex (no `_`), so parsing does not rely on
 * `<secret>` being free of `_` — base64url itself permits it.
 */
const KEY_STATIC_MARKER = 'fup';
const KEY_PREFIX_LENGTH = 12;

const ENVIRONMENT_TOKENS: ReadonlyMap<ApiEnvironment, 'test' | 'live'> = new Map([
  ['TEST', 'test'],
  ['LIVE', 'live'],
]);

export interface GeneratedApiKey {
  readonly fullKey: string;
  readonly prefix: string;
  readonly secret: string;
}

export function generateApiKey(environment: ApiEnvironment): GeneratedApiKey {
  const envToken = ENVIRONMENT_TOKENS.get(environment);
  if (envToken === undefined) {
    throw new Error(`Unsupported API key environment: ${String(environment)}`);
  }

  const prefix = randomBytes(KEY_PREFIX_LENGTH / 2).toString('hex');
  const secret = generateOpaqueToken();
  const fullKey = `${KEY_STATIC_MARKER}_${envToken}_${prefix}_${secret}`;

  return { fullKey, prefix, secret };
}

export interface ParsedApiKey {
  readonly environment: ApiEnvironment;
  readonly prefix: string;
  readonly secret: string;
}

/** Returns `undefined` for any input that doesn't match the expected shape — never throws on malformed input. */
export function parseApiKey(raw: string): ParsedApiKey | undefined {
  for (const [environment, envToken] of ENVIRONMENT_TOKENS) {
    const staticPrefix = `${KEY_STATIC_MARKER}_${envToken}_`;
    if (!raw.startsWith(staticPrefix)) continue;

    const remainder = raw.slice(staticPrefix.length);
    const prefix = remainder.slice(0, KEY_PREFIX_LENGTH);
    const separator = remainder.charAt(KEY_PREFIX_LENGTH);
    const secret = remainder.slice(KEY_PREFIX_LENGTH + 1);

    if (prefix.length !== KEY_PREFIX_LENGTH || separator !== '_' || secret.length === 0) {
      return undefined;
    }

    return { environment, prefix, secret };
  }

  return undefined;
}
