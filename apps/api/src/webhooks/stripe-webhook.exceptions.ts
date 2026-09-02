import { HttpStatus } from '@nestjs/common';
import {
  isStripeWebhookPayloadError,
  isStripeWebhookSignatureError,
} from '@fraterunion-payments/provider-stripe';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes.constants';

export class StripeWebhookNotConfiguredException extends AppException {
  constructor() {
    super(
      ERROR_CODES.PROVIDER_CONFIGURATION_ERROR,
      'Stripe webhook ingestion is not configured.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class StripeWebhookInvalidSignatureException extends AppException {
  constructor() {
    super(
      ERROR_CODES.STRIPE_WEBHOOK_INVALID_SIGNATURE,
      'Stripe webhook signature is invalid.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class StripeWebhookInvalidPayloadException extends AppException {
  constructor() {
    super(
      ERROR_CODES.STRIPE_WEBHOOK_INVALID_PAYLOAD,
      'Stripe webhook payload is invalid.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export function mapStripeWebhookError(error: unknown): AppException | undefined {
  if (isStripeWebhookSignatureError(error)) {
    return new StripeWebhookInvalidSignatureException();
  }
  if (isStripeWebhookPayloadError(error)) {
    return new StripeWebhookInvalidPayloadException();
  }
  return undefined;
}
