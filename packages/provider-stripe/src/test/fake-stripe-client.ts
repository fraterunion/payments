import Stripe from 'stripe';
import type { StripeRequestOptions } from '../request-options.js';
import type {
  StripeClientPort,
  StripeCustomerCreateParams,
  StripePaymentIntentCaptureParams,
  StripePaymentIntentCreateParams,
  StripePaymentIntentSnapshot,
  StripeRefundCreateParams,
  StripeRefundSnapshot,
} from '../stripe-client.js';

export type FakeStripeBehavior = 'strict' | 'contract';

export type FakeStripeClientOptions = {
  readonly behavior?: FakeStripeBehavior;
};

type StoredIntent = StripePaymentIntentSnapshot & {
  readonly client_secret: string;
};

export class FakeStripeClient implements StripeClientPort {
  readonly lastOptions: {
    createCustomer?: StripeRequestOptions | undefined;
    createPaymentIntent?: StripeRequestOptions | undefined;
    capturePaymentIntent?: StripeRequestOptions | undefined;
    cancelPaymentIntent?: StripeRequestOptions | undefined;
    refundCreate?: StripeRequestOptions | undefined;
    retrievePaymentIntent?: StripeRequestOptions | undefined;
  } = {};

  readonly lastCreatePaymentIntentParams: StripePaymentIntentCreateParams[] = [];
  readonly lastCaptureParams: Array<{
    readonly id: string;
    readonly params?: StripePaymentIntentCaptureParams | undefined;
  }> = [];
  readonly lastRefundParams: StripeRefundCreateParams[] = [];
  readonly lastCreateCustomerParams: StripeCustomerCreateParams[] = [];

  private readonly behavior: FakeStripeBehavior;
  private readonly intentStore = new Map<string, StoredIntent>();
  private readonly idempotent = new Map<string, unknown>();
  private sequence = 0;
  private forcedError: unknown;

  constructor(options: FakeStripeClientOptions = {}) {
    this.behavior = options.behavior ?? 'strict';
  }

  failNext(error: unknown): void {
    this.forcedError = error;
  }

  readonly customers = {
    create: async (
      params: StripeCustomerCreateParams,
      options?: StripeRequestOptions,
    ): Promise<{ readonly id: string }> => {
      this.throwForced();
      this.lastOptions.createCustomer = options;
      this.lastCreateCustomerParams.push(params);
      const cached = this.recall<{ readonly id: string }>('customers.create', options);
      if (cached) {
        return cached;
      }
      const created = { id: `cus_${this.nextId()}` };
      this.remember('customers.create', options, created);
      return created;
    },
  };

  readonly paymentIntents = {
    create: async (
      params: StripePaymentIntentCreateParams,
      options?: StripeRequestOptions,
    ): Promise<StripePaymentIntentSnapshot> => {
      this.throwForced();
      this.lastOptions.createPaymentIntent = options;
      this.lastCreatePaymentIntentParams.push(params);
      const cached = this.recall<StripePaymentIntentSnapshot>('paymentIntents.create', options);
      if (cached) {
        return cached;
      }
      if (params.payment_method === 'pm_card_chargeDeclined') {
        throw this.decline(params, 'Your card was declined.', 'card_declined', 'generic_decline');
      }
      if (params.payment_method === 'pm_card_visa_chargeDeclinedInsufficientFunds') {
        throw this.decline(
          params,
          'Your card has insufficient funds.',
          'card_declined',
          'insufficient_funds',
        );
      }
      const overrides =
        params.payment_method === 'pm_requires_action'
          ? {
              status: 'requires_action',
              amount_capturable: params.capture_method === 'manual' ? params.amount : 0,
              amount_received: 0,
              next_action: { type: 'redirect_to_url' as const },
            }
          : this.initialState(params);
      const intent = this.buildIntent(params, overrides);
      this.intentStore.set(intent.id, intent);
      const published = this.publicIntent(intent);
      this.remember('paymentIntents.create', options, published);
      return published;
    },

    capture: async (
      id: string,
      params?: StripePaymentIntentCaptureParams,
      options?: StripeRequestOptions,
    ): Promise<StripePaymentIntentSnapshot> => {
      this.throwForced();
      this.lastOptions.capturePaymentIntent = options;
      this.lastCaptureParams.push({ id, params });
      const cached = this.recall<StripePaymentIntentSnapshot>('paymentIntents.capture', options);
      if (cached) {
        return cached;
      }
      const current = this.requireIntent(id);
      const amountToCapture = params?.amount_to_capture ?? current.amount_capturable;
      const next: StoredIntent = {
        ...current,
        status: 'succeeded',
        amount_received: amountToCapture,
        amount_capturable: 0,
        last_payment_error: null,
        next_action: null,
      };
      this.intentStore.set(id, next);
      const published = this.publicIntent(next);
      this.remember('paymentIntents.capture', options, published);
      return published;
    },

    cancel: async (
      id: string,
      _params?: Record<string, never>,
      options?: StripeRequestOptions,
    ): Promise<StripePaymentIntentSnapshot> => {
      this.throwForced();
      this.lastOptions.cancelPaymentIntent = options;
      const cached = this.recall<StripePaymentIntentSnapshot>('paymentIntents.cancel', options);
      if (cached) {
        return cached;
      }
      const current = this.requireIntent(id);
      const next: StoredIntent = {
        ...current,
        status: 'canceled',
        amount_capturable: 0,
        last_payment_error: null,
        next_action: null,
      };
      this.intentStore.set(id, next);
      const published = this.publicIntent(next);
      this.remember('paymentIntents.cancel', options, published);
      return published;
    },

    retrieve: async (
      id: string,
      _params?: Record<string, never>,
      options?: StripeRequestOptions,
    ): Promise<StripePaymentIntentSnapshot> => {
      this.throwForced();
      this.lastOptions.retrievePaymentIntent = options;
      return this.publicIntent(this.requireIntent(id));
    },
  };

  readonly refunds = {
    create: async (
      params: StripeRefundCreateParams,
      options?: StripeRequestOptions,
    ): Promise<StripeRefundSnapshot> => {
      this.throwForced();
      this.lastOptions.refundCreate = options;
      this.lastRefundParams.push(params);
      const cached = this.recall<StripeRefundSnapshot>('refunds.create', options);
      if (cached) {
        return cached;
      }
      const refund: StripeRefundSnapshot = {
        id: `re_${this.nextId()}`,
        status: 'succeeded',
      };
      this.remember('refunds.create', options, refund);
      return refund;
    },
  };

  private throwForced(): void {
    if (this.forcedError !== undefined) {
      const error = this.forcedError;
      this.forcedError = undefined;
      throw error;
    }
  }

  private initialState(
    params: StripePaymentIntentCreateParams,
  ): Partial<StripePaymentIntentSnapshot> {
    if (this.behavior === 'contract') {
      return {
        status: 'requires_capture',
        amount_capturable: params.amount,
        amount_received: 0,
      };
    }
    const confirmed = Boolean(params.payment_method && params.confirm);
    if (!confirmed) {
      return {
        status: 'requires_payment_method',
        amount_capturable: 0,
        amount_received: 0,
      };
    }
    if (params.capture_method === 'manual') {
      return {
        status: 'requires_capture',
        amount_capturable: params.amount,
        amount_received: 0,
      };
    }
    return {
      status: 'succeeded',
      amount_capturable: 0,
      amount_received: params.amount,
    };
  }

  private buildIntent(
    params: StripePaymentIntentCreateParams,
    overrides: Partial<StripePaymentIntentSnapshot>,
  ): StoredIntent {
    const id = `pi_${this.nextId()}`;
    return {
      id,
      status: 'requires_payment_method',
      amount: params.amount,
      currency: params.currency,
      capture_method: params.capture_method,
      amount_capturable: 0,
      amount_received: 0,
      last_payment_error: null,
      next_action: null,
      client_secret: `pi_secret_${id}`,
      ...overrides,
    };
  }

  private publicIntent(intent: StoredIntent): StripePaymentIntentSnapshot {
    return {
      id: intent.id,
      status: intent.status,
      amount: intent.amount,
      currency: intent.currency,
      capture_method: intent.capture_method,
      amount_capturable: intent.amount_capturable,
      amount_received: intent.amount_received,
      last_payment_error: intent.last_payment_error,
      next_action: intent.next_action,
    };
  }

  private requireIntent(id: string): StoredIntent {
    const intent = this.intentStore.get(id);
    if (intent === undefined) {
      throw new Stripe.errors.StripeInvalidRequestError({
        message: 'No such payment_intent',
        type: 'invalid_request_error',
        statusCode: 404,
      });
    }
    return intent;
  }

  private decline(
    params: StripePaymentIntentCreateParams,
    message: string,
    code: string,
    declineCode: string,
  ): Stripe.errors.StripeCardError {
    const intent = this.buildIntent(params, {
      status: 'requires_payment_method',
      amount_capturable: 0,
      amount_received: 0,
      last_payment_error: {
        type: 'card_error',
        code,
        decline_code: declineCode,
        message,
      },
    });
    this.intentStore.set(intent.id, intent);
    const error = new Stripe.errors.StripeCardError({
      message,
      type: 'card_error',
      code,
      decline_code: declineCode,
      statusCode: 402,
    });
    Object.assign(error, { payment_intent: this.publicIntent(intent) });
    return error;
  }

  private remember(
    operation: string,
    options: StripeRequestOptions | undefined,
    value: unknown,
  ): void {
    if (options?.idempotencyKey !== undefined) {
      this.idempotent.set(`${operation}:${options.idempotencyKey}`, value);
    }
  }

  private recall<T>(operation: string, options: StripeRequestOptions | undefined): T | undefined {
    if (options?.idempotencyKey === undefined) {
      return undefined;
    }
    return this.idempotent.get(`${operation}:${options.idempotencyKey}`) as T | undefined;
  }

  private nextId(): string {
    this.sequence += 1;
    return String(this.sequence);
  }
}

export function createFakeStripeClient(options: FakeStripeClientOptions = {}): FakeStripeClient {
  return new FakeStripeClient(options);
}
