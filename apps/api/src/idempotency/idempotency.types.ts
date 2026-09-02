export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export const IDEMPOTENCY_SCOPE_MAX_LENGTH = 64;
export const IDEMPOTENCY_SCOPE_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

/**
 * Closed registry of financial-command scopes. Provider-neutral.
 * Reserved mutation scopes are not publicly callable yet.
 */
export const IDEMPOTENCY_SCOPES = {
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_AUTHORIZE: 'payment.authorize',
  PAYMENT_CAPTURE: 'payment.capture',
  PAYMENT_CANCEL: 'payment.cancel',
  REFUND_CREATE: 'refund.create',
  REFUND_EXECUTE: 'refund.execute',
} as const;

export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPES)[keyof typeof IDEMPOTENCY_SCOPES];

export const IDEMPOTENCY_RECORD_STATUSES = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;

export type IdempotencyRecordStatusName =
  (typeof IDEMPOTENCY_RECORD_STATUSES)[keyof typeof IDEMPOTENCY_RECORD_STATUSES];

export const IDEMPOTENCY_RESOURCE_TYPES = {
  PAYMENT: 'payment',
  REFUND: 'refund',
} as const;

export type IdempotencyResourceType =
  (typeof IDEMPOTENCY_RESOURCE_TYPES)[keyof typeof IDEMPOTENCY_RESOURCE_TYPES];

export const IDEMPOTENCY_RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9]*$/;

const SCOPE_VALUES: ReadonlySet<string> = new Set(Object.values(IDEMPOTENCY_SCOPES));
const RESOURCE_TYPE_VALUES: ReadonlySet<string> = new Set(
  Object.values(IDEMPOTENCY_RESOURCE_TYPES),
);

export function isIdempotencyScope(value: string): value is IdempotencyScope {
  return SCOPE_VALUES.has(value);
}

export function asIdempotencyScope(value: string): IdempotencyScope {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Idempotency scope is required.');
  }
  if (value.length > IDEMPOTENCY_SCOPE_MAX_LENGTH) {
    throw new Error(
      `Idempotency scope must be at most ${IDEMPOTENCY_SCOPE_MAX_LENGTH} characters.`,
    );
  }
  if (hasControlCharacters(value) || !IDEMPOTENCY_SCOPE_PATTERN.test(value)) {
    throw new Error('Idempotency scope must be lowercase dot notation from the registry.');
  }
  if (!isIdempotencyScope(value)) {
    throw new Error('Idempotency scope is not a registered financial operation.');
  }
  return value;
}

export function asIdempotencyResourceType(value: string): IdempotencyResourceType {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Idempotency resource type is required.');
  }
  if (hasControlCharacters(value) || !IDEMPOTENCY_RESOURCE_TYPE_PATTERN.test(value)) {
    throw new Error('Idempotency resource type must be a lowercase registry token.');
  }
  if (!RESOURCE_TYPE_VALUES.has(value)) {
    throw new Error('Idempotency resource type is not registered.');
  }
  return value as IdempotencyResourceType;
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
