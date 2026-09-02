import { createHash } from 'node:crypto';
import { IDEMPOTENCY_KEY_MAX_LENGTH } from './idempotency.types';
import {
  IdempotencyKeyInvalidException,
  IdempotencyKeyRequiredException,
} from './idempotency.exceptions';

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

export function fingerprintCanonicalPayload(payload: unknown): string {
  return sha256Hex(JSON.stringify(canonicalizeJson(payload)));
}

/**
 * Canonical JSON: object keys are sorted recursively so raw property order
 * cannot produce a different fingerprint.
 */
export function canonicalizeJson(value: unknown): unknown {
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
  return value;
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
