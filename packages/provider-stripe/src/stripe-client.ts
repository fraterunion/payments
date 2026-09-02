import Stripe from 'stripe';
import type { StripeApiVersion } from './api-version.js';
import type { StripeRequestOptions } from './request-options.js';

export type StripeFailureSource = {
  readonly code?: string;
  readonly decline_code?: string;
  readonly message?: string;
  readonly type?: string;
};

export type StripeNextActionSource = {
  readonly type: string;
};

export type StripePaymentIntentSnapshot = {
  readonly id: string;
  readonly status: string;
  readonly amount: number;
  readonly currency: string;
  readonly capture_method: string;
  readonly amount_capturable: number;
  readonly amount_received: number;
  readonly last_payment_error: StripeFailureSource | null;
  readonly next_action: StripeNextActionSource | null;
};

export type StripeRefundSnapshot = {
  readonly id: string;
  readonly status: string | null;
  readonly failure_reason?: string;
};

export type StripeCustomerCreateParams = {
  readonly email?: string;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, string>>;
};

export type StripePaymentIntentCreateParams = {
  readonly amount: number;
  readonly currency: string;
  readonly capture_method: 'automatic' | 'manual';
  readonly confirm?: boolean;
  readonly customer?: string;
  readonly payment_method?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly off_session?: boolean;
};

export type StripePaymentIntentCaptureParams = {
  readonly amount_to_capture?: number;
};

export type StripeRefundCreateParams = {
  readonly payment_intent: string;
  readonly amount: number;
  readonly reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
};

export type StripeClientPort = {
  readonly customers: {
    create(
      params: StripeCustomerCreateParams,
      options?: StripeRequestOptions,
    ): Promise<{ readonly id: string }>;
  };
  readonly paymentIntents: {
    create(
      params: StripePaymentIntentCreateParams,
      options?: StripeRequestOptions,
    ): Promise<StripePaymentIntentSnapshot>;
    capture(
      id: string,
      params?: StripePaymentIntentCaptureParams,
      options?: StripeRequestOptions,
    ): Promise<StripePaymentIntentSnapshot>;
    cancel(
      id: string,
      params?: Record<string, never>,
      options?: StripeRequestOptions,
    ): Promise<StripePaymentIntentSnapshot>;
    retrieve(
      id: string,
      params?: Record<string, never>,
      options?: StripeRequestOptions,
    ): Promise<StripePaymentIntentSnapshot>;
  };
  readonly refunds: {
    create(
      params: StripeRefundCreateParams,
      options?: StripeRequestOptions,
    ): Promise<StripeRefundSnapshot>;
  };
};

export type StripeLiveClientConfig = {
  readonly secretKey: string;
  readonly apiVersion: StripeApiVersion;
  readonly appInfo?: {
    readonly name: string;
    readonly version?: string;
    readonly url?: string;
    readonly partner_id?: string;
  };
};

export function snapshotFailureSource(error: {
  readonly code?: string;
  readonly decline_code?: string;
  readonly message?: string;
  readonly type?: string;
}): StripeFailureSource {
  return {
    ...(error.code !== undefined ? { code: error.code } : {}),
    ...(error.decline_code !== undefined ? { decline_code: error.decline_code } : {}),
    ...(error.message !== undefined ? { message: error.message } : {}),
    ...(error.type !== undefined ? { type: error.type } : {}),
  };
}

function snapshotPaymentIntent(intent: Stripe.PaymentIntent): StripePaymentIntentSnapshot {
  return {
    id: intent.id,
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
    capture_method: intent.capture_method,
    amount_capturable: intent.amount_capturable,
    amount_received: intent.amount_received,
    last_payment_error: intent.last_payment_error
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
      : null,
    next_action: intent.next_action ? { type: intent.next_action.type } : null,
  };
}

function snapshotRefund(refund: Stripe.Refund): StripeRefundSnapshot {
  return {
    id: refund.id,
    status: refund.status,
    ...(refund.failure_reason !== undefined ? { failure_reason: refund.failure_reason } : {}),
  };
}

/**
 * Wraps the official Stripe SDK. Not part of the public adapter API.
 */
export function createLiveStripeClient(config: StripeLiveClientConfig): StripeClientPort {
  const stripe = new Stripe(config.secretKey, {
    apiVersion: config.apiVersion,
    ...(config.appInfo !== undefined ? { appInfo: { ...config.appInfo } } : {}),
    maxNetworkRetries: 0,
    typescript: true,
  });

  return {
    customers: {
      create: async (params, options) => {
        const customer = await stripe.customers.create({ ...params }, options);
        return { id: customer.id };
      },
    },
    paymentIntents: {
      create: async (params, options) =>
        snapshotPaymentIntent(await stripe.paymentIntents.create({ ...params }, options)),
      capture: async (id, params, options) =>
        snapshotPaymentIntent(await stripe.paymentIntents.capture(id, { ...params }, options)),
      cancel: async (id, params, options) =>
        snapshotPaymentIntent(await stripe.paymentIntents.cancel(id, params, options)),
      retrieve: async (id, params, options) =>
        snapshotPaymentIntent(await stripe.paymentIntents.retrieve(id, params, options)),
    },
    refunds: {
      create: async (params, options) =>
        snapshotRefund(await stripe.refunds.create({ ...params }, options)),
    },
  };
}
