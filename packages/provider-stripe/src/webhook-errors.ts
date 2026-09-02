export class StripeWebhookSignatureError extends Error {
  readonly code = 'STRIPE_WEBHOOK_INVALID_SIGNATURE';

  constructor(message = 'Stripe webhook signature is invalid.') {
    super(message);
    this.name = 'StripeWebhookSignatureError';
  }
}

export class StripeWebhookPayloadError extends Error {
  readonly code = 'STRIPE_WEBHOOK_INVALID_PAYLOAD';

  constructor(message = 'Stripe webhook payload is invalid.') {
    super(message);
    this.name = 'StripeWebhookPayloadError';
  }
}

export function isStripeWebhookSignatureError(
  error: unknown,
): error is StripeWebhookSignatureError {
  return error instanceof StripeWebhookSignatureError;
}

export function isStripeWebhookPayloadError(error: unknown): error is StripeWebhookPayloadError {
  return error instanceof StripeWebhookPayloadError;
}
