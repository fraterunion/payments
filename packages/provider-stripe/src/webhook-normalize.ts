import {
  ProviderContractError,
  createProviderAccountReference,
  createProviderPaymentReference,
  createProviderRefundReference,
  type ProviderAccountReference,
  type ProviderPaymentObservation,
  type ProviderPaymentReference,
  type ProviderRefundReference,
  type ProviderRefundResult,
} from '@fraterunion-payments/provider-contracts';
import {
  createMoney,
  createPaymentFailure,
  PAYMENT_FAILURE_CATEGORIES,
  REFUND_STATES,
  type Money,
  type RefundState,
} from '@fraterunion-payments/payment-core';
import { STRIPE_PROVIDER_CODE } from './constants.js';
import { observeStripePaymentIntent, observeStripeRefund } from './observe.js';
import { fromStripeAmount } from './money.js';
import type { StripePaymentIntentSnapshot, StripeRefundSnapshot } from './stripe-client.js';

export const STRIPE_FINANCIAL_PAYMENT_EVENT_TYPES = [
  'payment_intent.amount_capturable_updated',
  'payment_intent.processing',
  'payment_intent.requires_action',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
] as const;

export const STRIPE_FINANCIAL_REFUND_EVENT_TYPES = [
  'refund.created',
  'refund.updated',
  'refund.failed',
] as const;

const PAYMENT_TYPE_SET = new Set<string>(STRIPE_FINANCIAL_PAYMENT_EVENT_TYPES);
const REFUND_TYPE_SET = new Set<string>(STRIPE_FINANCIAL_REFUND_EVENT_TYPES);

export class StripeWebhookNormalizeError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'StripeWebhookNormalizeError';
    this.code = code;
  }
}

export type NormalizedStripeFinancialEvent =
  | {
      readonly kind: 'payment';
      readonly eventType: string;
      readonly providerPayment: ProviderPaymentReference;
      readonly providerAccount?: ProviderAccountReference;
      readonly observation: ProviderPaymentObservation;
      readonly requestedAmount: Money;
    }
  | {
      readonly kind: 'refund';
      readonly eventType: string;
      readonly providerRefund: ProviderRefundReference;
      readonly providerPayment?: ProviderPaymentReference;
      readonly providerAccount?: ProviderAccountReference;
      readonly state: RefundState;
      readonly amount: Money;
      readonly observation: ProviderRefundResult;
    }
  | {
      readonly kind: 'ignored';
      readonly eventType: string;
      readonly reason: 'IGNORED_EVENT_TYPE';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StripeWebhookNormalizeError(
      `Stripe event is missing ${label}.`,
      'UNSUPPORTED_PROVIDER_EVENT_VERSION',
    );
  }
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new StripeWebhookNormalizeError(
      `Stripe event is missing ${label}.`,
      'UNSUPPORTED_PROVIDER_EVENT_VERSION',
    );
  }
  return value;
}

function eventAccount(payload: Record<string, unknown>): ProviderAccountReference | undefined {
  const account = payload['account'];
  if (account === undefined || account === null) {
    return undefined;
  }
  if (typeof account !== 'string' || account.trim().length === 0) {
    throw new StripeWebhookNormalizeError(
      'Stripe event account is invalid.',
      'UNSUPPORTED_PROVIDER_EVENT_VERSION',
    );
  }
  return createProviderAccountReference({ provider: STRIPE_PROVIDER_CODE, id: account });
}

function parsePaymentIntent(object: Record<string, unknown>): StripePaymentIntentSnapshot {
  if (object['object'] !== 'payment_intent') {
    throw new StripeWebhookNormalizeError(
      'PaymentIntent event data.object.object must be payment_intent.',
      'MALFORMED_PROVIDER_OBJECT',
    );
  }
  const id = requiredString(object['id'], 'payment_intent.id');
  if (!id.startsWith('pi_')) {
    throw new StripeWebhookNormalizeError(
      'PaymentIntent id has an unexpected shape.',
      'MALFORMED_PROVIDER_OBJECT',
    );
  }
  const lastError = object['last_payment_error'];
  const nextAction = object['next_action'];
  return {
    id,
    status: requiredString(object['status'], 'payment_intent.status'),
    amount: requiredNumber(object['amount'], 'payment_intent.amount'),
    currency: requiredString(object['currency'], 'payment_intent.currency'),
    capture_method: requiredString(object['capture_method'], 'payment_intent.capture_method'),
    amount_capturable: requiredNumber(
      object['amount_capturable'],
      'payment_intent.amount_capturable',
    ),
    amount_received: requiredNumber(object['amount_received'], 'payment_intent.amount_received'),
    last_payment_error: isRecord(lastError)
      ? {
          ...(typeof lastError['code'] === 'string' ? { code: lastError['code'] } : {}),
          ...(typeof lastError['decline_code'] === 'string'
            ? { decline_code: lastError['decline_code'] }
            : {}),
          ...(typeof lastError['message'] === 'string' ? { message: lastError['message'] } : {}),
          ...(typeof lastError['type'] === 'string' ? { type: lastError['type'] } : {}),
        }
      : null,
    next_action:
      isRecord(nextAction) && typeof nextAction['type'] === 'string'
        ? { type: nextAction['type'] }
        : null,
  };
}

function parseRefund(object: Record<string, unknown>): StripeRefundSnapshot & {
  readonly amount: number;
  readonly currency: string;
  readonly payment_intent?: string;
} {
  if (object['object'] !== 'refund') {
    throw new StripeWebhookNormalizeError(
      'Refund event data.object.object must be refund.',
      'MALFORMED_PROVIDER_OBJECT',
    );
  }
  const id = requiredString(object['id'], 'refund.id');
  if (!id.startsWith('re_')) {
    throw new StripeWebhookNormalizeError(
      'Refund id has an unexpected shape.',
      'MALFORMED_PROVIDER_OBJECT',
    );
  }
  const paymentIntent = object['payment_intent'];
  return {
    id,
    status: typeof object['status'] === 'string' ? object['status'] : null,
    amount: requiredNumber(object['amount'], 'refund.amount'),
    currency: requiredString(object['currency'], 'refund.currency'),
    ...(typeof object['failure_reason'] === 'string'
      ? { failure_reason: object['failure_reason'] }
      : {}),
    ...(typeof paymentIntent === 'string' ? { payment_intent: paymentIntent } : {}),
  };
}

function dataObject(payload: Record<string, unknown>): Record<string, unknown> {
  const data = payload['data'];
  if (!isRecord(data)) {
    throw new StripeWebhookNormalizeError(
      'Stripe event data is missing.',
      'UNSUPPORTED_PROVIDER_EVENT_VERSION',
    );
  }
  const object = data['object'];
  if (!isRecord(object)) {
    throw new StripeWebhookNormalizeError(
      'Stripe event data.object is missing.',
      'UNSUPPORTED_PROVIDER_EVENT_VERSION',
    );
  }
  return object;
}

/**
 * Classifies a verified Stripe Event JSON object. The contained
 * PaymentIntent/Refund uses the same observation mappers as retrieve.
 * Event `account` is the only Connect account authority — never metadata.
 */
export function normalizeStripeFinancialEvent(payload: unknown): NormalizedStripeFinancialEvent {
  if (!isRecord(payload)) {
    throw new StripeWebhookNormalizeError(
      'Stripe event payload must be an object.',
      'MALFORMED_PROVIDER_OBJECT',
    );
  }
  const eventType = requiredString(payload['type'], 'type');
  const providerAccount = eventAccount(payload);
  const created =
    typeof payload['created'] === 'number' ? new Date(payload['created'] * 1000) : new Date();

  if (
    eventType === 'payment_intent.created' ||
    (!PAYMENT_TYPE_SET.has(eventType) && !REFUND_TYPE_SET.has(eventType))
  ) {
    return { kind: 'ignored', eventType, reason: 'IGNORED_EVENT_TYPE' };
  }

  if (PAYMENT_TYPE_SET.has(eventType)) {
    const intent = parsePaymentIntent(dataObject(payload));
    let observation;
    try {
      observation = observeStripePaymentIntent({
        intent,
        operation: 'retrieve',
        observedAt: created,
      });
    } catch (error) {
      if (error instanceof ProviderContractError) {
        throw new StripeWebhookNormalizeError(error.message, 'UNSUPPORTED_PROVIDER_EVENT_VERSION');
      }
      throw error;
    }
    return {
      kind: 'payment',
      eventType,
      providerPayment: createProviderPaymentReference({
        provider: STRIPE_PROVIDER_CODE,
        id: intent.id,
      }),
      observation,
      requestedAmount: createMoney(fromStripeAmount(intent.amount), intent.currency),
      ...(providerAccount !== undefined ? { providerAccount } : {}),
    };
  }

  const refund = parseRefund(dataObject(payload));
  let observed;
  try {
    observed = observeStripeRefund({ refund, observedAt: created });
  } catch (error) {
    if (error instanceof ProviderContractError) {
      throw new StripeWebhookNormalizeError(error.message, 'UNSUPPORTED_PROVIDER_EVENT_VERSION');
    }
    throw error;
  }
  const observation =
    observed.state === REFUND_STATES.FAILED && observed.failure === undefined
      ? {
          ...observed,
          failure: createPaymentFailure({
            category: PAYMENT_FAILURE_CATEGORIES.PROVIDER,
            message: 'The provider refund failed.',
            retryable: false,
          }),
        }
      : observed;
  return {
    kind: 'refund',
    eventType,
    providerRefund: createProviderRefundReference({
      provider: STRIPE_PROVIDER_CODE,
      id: refund.id,
    }),
    state: observation.state,
    amount: createMoney(fromStripeAmount(refund.amount), refund.currency),
    observation,
    ...(typeof refund.payment_intent === 'string'
      ? {
          providerPayment: createProviderPaymentReference({
            provider: STRIPE_PROVIDER_CODE,
            id: refund.payment_intent,
          }),
        }
      : {}),
    ...(providerAccount !== undefined ? { providerAccount } : {}),
  };
}
