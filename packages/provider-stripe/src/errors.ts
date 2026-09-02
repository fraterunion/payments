import Stripe from 'stripe';
import {
  isProviderContractError,
  ProviderAuthenticationError,
  ProviderConfigurationError,
  ProviderContractError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  PROVIDER_ERROR_CODES,
} from '@fraterunion-payments/provider-contracts';
import { snapshotFailureSource, type StripePaymentIntentSnapshot } from './stripe-client.js';

const GENERIC_UNAVAILABLE = 'The payment provider is unavailable.';
const GENERIC_TIMEOUT = 'The payment provider timed out.';
const GENERIC_AUTH = 'Payment provider authentication failed.';
const GENERIC_RATE_LIMIT = 'The payment provider rate-limited the request.';
const GENERIC_CONFIG = 'The payment provider rejected the request as invalid.';
const GENERIC_CONTRACT = 'The payment provider request failed.';

function parseRetryAfterMs(
  headers: { readonly [header: string]: string } | undefined,
): number | undefined {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (raw === undefined) {
    return undefined;
  }
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds * 1000;
}

function isTimeoutLike(error: { readonly message?: string }): boolean {
  const message = error.message?.toLowerCase() ?? '';
  return (
    message.includes('timeout') || message.includes('timed out') || message.includes('etimedout')
  );
}

export function isStripeBusinessPaymentError(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeCardError;
}

export function stripeErrorPaymentIntent(error: unknown): StripePaymentIntentSnapshot | undefined {
  if (!(error instanceof Stripe.errors.StripeError) || error.payment_intent === undefined) {
    return undefined;
  }
  const intent = error.payment_intent;
  const lastPaymentError = intent.last_payment_error
    ? snapshotFailureSource({
        ...(intent.last_payment_error.code !== undefined
          ? { code: intent.last_payment_error.code }
          : {}),
        ...(intent.last_payment_error.decline_code !== undefined
          ? { decline_code: intent.last_payment_error.decline_code }
          : {}),
        ...(intent.last_payment_error.message !== undefined
          ? { message: intent.last_payment_error.message }
          : {}),
        type: intent.last_payment_error.type,
      })
    : snapshotFailureSource({
        ...(error.code !== undefined ? { code: error.code } : {}),
        ...(error.decline_code !== undefined ? { decline_code: error.decline_code } : {}),
        ...(error.message !== undefined ? { message: error.message } : {}),
        ...(error.rawType !== undefined ? { type: error.rawType } : { type: error.type }),
      });
  return {
    id: intent.id,
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
    capture_method: intent.capture_method,
    amount_capturable: intent.amount_capturable,
    amount_received: intent.amount_received,
    last_payment_error: lastPaymentError,
    next_action: intent.next_action ? { type: intent.next_action.type } : null,
  };
}

const CONNECT_PLATFORM_BLOCKED_CODES = new Set([
  'accounts_v2_access_blocked',
  'platform_registration_required',
  'account_create_activation_required',
]);

export function isStripeConnectPlatformBlocked(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeError)) {
    return false;
  }
  const code = error.code ?? '';
  if (CONNECT_PLATFORM_BLOCKED_CODES.has(code)) {
    return true;
  }
  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('accounts_v2_access_blocked') ||
    message.includes('platform_registration_required') ||
    message.includes('account_create_activation_required')
  );
}

export function normalizeStripeError(error: unknown): never {
  if (isProviderContractError(error)) {
    throw error;
  }

  if (error instanceof Stripe.errors.StripeAuthenticationError) {
    throw new ProviderAuthenticationError(GENERIC_AUTH);
  }
  if (error instanceof Stripe.errors.StripePermissionError) {
    throw new ProviderAuthenticationError(GENERIC_AUTH);
  }
  if (error instanceof Stripe.errors.StripeRateLimitError) {
    throw new ProviderRateLimitError(GENERIC_RATE_LIMIT, parseRetryAfterMs(error.headers));
  }
  if (error instanceof Stripe.errors.StripeConnectionError) {
    if (isTimeoutLike(error)) {
      throw new ProviderTimeoutError(GENERIC_TIMEOUT);
    }
    throw new ProviderUnavailableError(GENERIC_UNAVAILABLE);
  }
  if (error instanceof Stripe.errors.StripeAPIError) {
    throw new ProviderUnavailableError(GENERIC_UNAVAILABLE);
  }
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    throw new ProviderConfigurationError(GENERIC_CONFIG);
  }
  if (error instanceof Stripe.errors.StripeIdempotencyError) {
    throw new ProviderContractError(GENERIC_CONTRACT, {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      retryable: false,
    });
  }
  if (error instanceof Stripe.errors.StripeError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      throw new ProviderAuthenticationError(GENERIC_AUTH);
    }
    if (error.statusCode === 429) {
      throw new ProviderRateLimitError(GENERIC_RATE_LIMIT, parseRetryAfterMs(error.headers));
    }
    if (error.statusCode !== undefined && error.statusCode >= 500) {
      throw new ProviderUnavailableError(GENERIC_UNAVAILABLE);
    }
    throw new ProviderContractError(GENERIC_CONTRACT, {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      retryable: false,
    });
  }

  if (error instanceof Error && isTimeoutLike(error)) {
    throw new ProviderTimeoutError(GENERIC_TIMEOUT);
  }

  throw new ProviderUnavailableError(GENERIC_UNAVAILABLE);
}
