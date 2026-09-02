import { createHash } from 'node:crypto';
import {
  IdempotencyKeyInvalidException,
  IdempotencyKeyRequiredException,
} from './idempotency.exceptions';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  asIdempotencyScope,
  type IdempotencyScope,
} from './idempotency.types';

export class IdempotencyFingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyFingerprintError';
  }
}

/**
 * Existing create endpoints trim surrounding whitespace. `"abc"` and
 * `" abc "` therefore hash as the same key. Idempotency keys are otherwise
 * opaque; we validate rather than applying further normalization.
 */
export function canonicalizeIdempotencyKey(value: string | undefined): string {
  if (value === undefined) {
    throw new IdempotencyKeyRequiredException();
  }
  if (typeof value !== 'string') {
    throw new IdempotencyKeyInvalidException('Idempotency-Key must be a string.');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new IdempotencyKeyRequiredException();
  }
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new IdempotencyKeyInvalidException(
      `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
    );
  }
  if (hasControlCharacters(trimmed)) {
    throw new IdempotencyKeyInvalidException(
      'Idempotency-Key must not contain control characters.',
    );
  }
  return trimmed;
}

export function hashIdempotencyKey(key: string): string {
  return sha256Hex(key);
}

/** Hash the header without returning the raw or trimmed key to callers. */
export function parseApiIdempotencyKey(value: string | undefined): { readonly keyHash: string } {
  return { keyHash: hashIdempotencyKey(canonicalizeIdempotencyKey(value)) };
}

export function fingerprintCanonicalPayload(payload: unknown): string {
  return sha256Hex(JSON.stringify(canonicalizeJson(payload)));
}

/**
 * Domain-separated fingerprint: `scope` and `organizationId` are always
 * siblings of the semantic request. Canonical object-key order means
 * insertion order cannot change the digest. Existing payment.create and
 * refund.create payloads use this same shape.
 */
export function fingerprintFinancialCommand(input: {
  readonly scope: IdempotencyScope;
  readonly organizationId: string;
  readonly request: Record<string, unknown>;
}): string {
  return fingerprintCanonicalPayload({
    ...input.request,
    scope: asIdempotencyScope(input.scope),
    organizationId: input.organizationId,
  });
}

/**
 * Canonical JSON: object keys are sorted recursively; arrays keep semantic
 * order. Unsupported values throw rather than producing a surprising digest.
 */
export function canonicalizeJson(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new IdempotencyFingerprintError('Fingerprint values must be finite numbers.');
    }
    return value;
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    throw new IdempotencyFingerprintError(`Unsupported fingerprint value type: ${typeof value}.`);
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalizeJson(value[key]);
    }
    return sorted;
  }
  throw new IdempotencyFingerprintError('Unsupported fingerprint value.');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
