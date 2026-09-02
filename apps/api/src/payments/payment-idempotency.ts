import { createHash } from 'node:crypto';
import type { PaymentCaptureMethod } from '@fraterunion-payments/database';
import { IDEMPOTENCY_KEY_MAX_LENGTH, PAYMENT_CREATE_IDEMPOTENCY_SCOPE } from './payment.types';
import {
  IdempotencyKeyInvalidException,
  IdempotencyKeyRequiredException,
} from './payment.exceptions';

export type PaymentCreateFingerprintInput = {
  readonly organizationId: string;
  readonly customerId?: string;
  readonly requestedAmount: bigint;
  readonly currency: string;
  readonly captureMethod: PaymentCaptureMethod;
  readonly description?: string;
  readonly metadata: Record<string, unknown>;
};

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

/**
 * Canonical fingerprint of semantically relevant payment-create fields.
 * Key order is sorted so raw JSON property order cannot create a second payment.
 */
export function paymentCreateFingerprint(input: PaymentCreateFingerprintInput): string {
  const canonical = canonicalizeJson({
    scope: PAYMENT_CREATE_IDEMPOTENCY_SCOPE,
    organizationId: input.organizationId,
    customerId: input.customerId ?? null,
    requestedAmount: input.requestedAmount.toString(10),
    currency: input.currency,
    captureMethod: input.captureMethod,
    description: input.description ?? null,
    metadata: input.metadata,
  });
  return sha256Hex(JSON.stringify(canonical));
}

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
