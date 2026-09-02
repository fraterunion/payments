import {
  createPaymentFailure,
  PAYMENT_FAILURE_CATEGORIES,
  type PaymentFailure,
} from '@fraterunion-payments/payment-core';
import type { StripeFailureSource } from './stripe-client.js';

const INSUFFICIENT_FUNDS = new Set(['insufficient_funds']);
const AUTHENTICATION = new Set(['authentication_required']);
const INVALID_PAYMENT_METHOD = new Set([
  'expired_card',
  'incorrect_cvc',
  'incorrect_number',
  'invalid_cvc',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'invalid_number',
  'lost_card',
  'stolen_card',
  'pickup_card',
  'card_not_supported',
  'currency_not_supported',
  'invalid_account',
]);
const PROCESSING = new Set([
  'processing_error',
  'issuer_not_available',
  'try_again_later',
  'reenter_transaction',
]);

const SAFE_FAILURE_MESSAGE = 'The payment method was declined.';

function firstCode(source: StripeFailureSource): string | undefined {
  const decline = source.decline_code?.trim();
  if (decline) {
    return decline;
  }
  const code = source.code?.trim();
  if (code) {
    return code;
  }
  return undefined;
}

function safeFailureMessage(source: StripeFailureSource): string {
  const message = source.message?.trim();
  if (message === undefined || message.length === 0) {
    return SAFE_FAILURE_MESSAGE;
  }
  if (/sk_(?:live|test)_/i.test(message) || /Bearer\s+\S+/i.test(message)) {
    return SAFE_FAILURE_MESSAGE;
  }
  return message;
}

export function mapStripePaymentFailure(
  source: StripeFailureSource | null | undefined,
): PaymentFailure | undefined {
  if (source === null || source === undefined) {
    return undefined;
  }

  const code = firstCode(source);
  const message = safeFailureMessage(source);

  if (code !== undefined && INSUFFICIENT_FUNDS.has(code)) {
    return createPaymentFailure({
      category: PAYMENT_FAILURE_CATEGORIES.INSUFFICIENT_FUNDS,
      message,
      retryable: false,
      code,
    });
  }
  if (code !== undefined && AUTHENTICATION.has(code)) {
    return createPaymentFailure({
      category: PAYMENT_FAILURE_CATEGORIES.AUTHENTICATION,
      message,
      retryable: true,
      code,
    });
  }
  if (code !== undefined && INVALID_PAYMENT_METHOD.has(code)) {
    return createPaymentFailure({
      category: PAYMENT_FAILURE_CATEGORIES.INVALID_PAYMENT_METHOD,
      message,
      retryable: false,
      code,
    });
  }
  if (code !== undefined && PROCESSING.has(code)) {
    return createPaymentFailure({
      category: PAYMENT_FAILURE_CATEGORIES.PROCESSING,
      message,
      retryable: true,
      code,
    });
  }
  if (source.type === 'card_error' || code !== undefined) {
    return createPaymentFailure({
      category: PAYMENT_FAILURE_CATEGORIES.DECLINED,
      message,
      retryable: false,
      ...(code !== undefined ? { code } : {}),
    });
  }

  return createPaymentFailure({
    category: PAYMENT_FAILURE_CATEGORIES.PROVIDER,
    message,
    retryable: false,
    ...(code !== undefined ? { code } : {}),
  });
}

export function mapStripeRefundFailure(
  failureReason: string | null | undefined,
): PaymentFailure | undefined {
  if (failureReason === null || failureReason === undefined || failureReason.trim().length === 0) {
    return undefined;
  }
  return createPaymentFailure({
    category: PAYMENT_FAILURE_CATEGORIES.PROVIDER,
    message: 'The provider refund failed.',
    retryable: false,
    code: failureReason.trim(),
  });
}
