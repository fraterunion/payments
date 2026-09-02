/**
 * Stable domain event names for a future application/outbox commit.
 * payment-core does not emit or persist these.
 */
export const PAYMENT_DOMAIN_EVENTS = {
  CREATED: 'payment.created',
  REQUIRES_PAYMENT_METHOD: 'payment.requires_payment_method',
  REQUIRES_ACTION: 'payment.requires_action',
  AUTHORIZING: 'payment.authorizing',
  AUTHORIZED: 'payment.authorized',
  CAPTURING: 'payment.capturing',
  SUCCEEDED: 'payment.succeeded',
  FAILED: 'payment.failed',
  CANCELED: 'payment.canceled',
  PARTIALLY_REFUNDED: 'payment.partially_refunded',
  REFUNDED: 'payment.refunded',
} as const;

export const REFUND_DOMAIN_EVENTS = {
  CREATED: 'refund.created',
  PROCESSING: 'refund.processing',
  SUCCEEDED: 'refund.succeeded',
  FAILED: 'refund.failed',
} as const;
