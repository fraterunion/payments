export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export const IDEMPOTENCY_SCOPES = {
  PAYMENT_CREATE: 'payment.create',
  REFUND_CREATE: 'refund.create',
} as const;

export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPES)[keyof typeof IDEMPOTENCY_SCOPES];

export const IDEMPOTENCY_RESOURCE_TYPES = {
  PAYMENT: 'payment',
  REFUND: 'refund',
} as const;
