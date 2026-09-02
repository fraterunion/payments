import { CAPTURE_METHODS, type Money } from '@fraterunion-payments/payment-core';
import {
  assertProviderOwns,
  assertProviderSupportsCustomerVault,
  assertProviderSupportsFullRefund,
  assertProviderSupportsManualCapture,
  assertProviderSupportsPartialCapture,
  assertProviderSupportsPartialRefund,
  createProviderCustomerResult,
  ProviderConfigurationError,
  ProviderContractError,
  PROVIDER_ERROR_CODES,
  UnsupportedProviderCapabilityError,
  type CancelProviderPaymentInput,
  type CaptureProviderPaymentInput,
  type CreateProviderCustomerInput,
  type CreateProviderCustomerResult,
  type CreateProviderPaymentInput,
  type PaymentProvider,
  type ProviderPaymentObservation,
  type ProviderRefundResult,
  type RefundProviderPaymentInput,
  type RetrieveProviderPaymentInput,
  type RetrieveProviderPaymentResult,
  createProviderCustomerReference,
} from '@fraterunion-payments/provider-contracts';
import { STRIPE_API_VERSION, type StripeApiVersion } from './api-version.js';
import { STRIPE_PROVIDER_CAPABILITIES, STRIPE_PROVIDER_CODE } from './constants.js';
import {
  isStripeBusinessPaymentError,
  normalizeStripeError,
  stripeErrorPaymentIntent,
} from './errors.js';
import { fromStripeAmount, moneyFromStripe, toStripeAmount, toStripeCurrency } from './money.js';
import {
  observeStripePaymentIntent,
  observeStripeRefund,
  retrieveStripePaymentIntent,
} from './observe.js';
import { mapStripeRefundReason } from './refund.js';
import { createStripeRequestOptions } from './request-options.js';
import {
  createLiveStripeClient,
  type StripeClientPort,
  type StripePaymentIntentSnapshot,
} from './stripe-client.js';

export type StripePaymentProviderConfig = {
  readonly secretKey: string;
  readonly apiVersion?: StripeApiVersion;
  readonly appInfo?: {
    readonly name: string;
    readonly version?: string;
    readonly url?: string;
    readonly partner_id?: string;
  };
};

type StripePaymentProviderInternals = {
  readonly client?: StripeClientPort;
  readonly now?: () => Date;
};

function requireSecretKey(secretKey: string): string {
  if (typeof secretKey !== 'string' || secretKey.trim().length === 0) {
    throw new ProviderConfigurationError('Stripe secret key is required.');
  }
  return secretKey;
}

function requireApiVersion(apiVersion: string | undefined): StripeApiVersion {
  if (apiVersion === undefined) {
    return STRIPE_API_VERSION;
  }
  if (apiVersion !== STRIPE_API_VERSION) {
    throw new ProviderConfigurationError('Unsupported Stripe API version.');
  }
  return apiVersion;
}

function assertCurrencyMatch(left: Money, right: Money, message: string): void {
  if (left.currency !== right.currency) {
    throw new ProviderContractError(message, {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
    });
  }
}

export class StripePaymentProvider implements PaymentProvider {
  readonly code = STRIPE_PROVIDER_CODE;
  readonly capabilities = STRIPE_PROVIDER_CAPABILITIES;
  readonly apiVersion: StripeApiVersion;

  readonly #client: StripeClientPort;
  readonly #now: () => Date;

  constructor(config: StripePaymentProviderConfig, internals: StripePaymentProviderInternals = {}) {
    requireSecretKey(config.secretKey);
    this.apiVersion = requireApiVersion(config.apiVersion);
    this.#client =
      internals.client ??
      createLiveStripeClient({
        secretKey: config.secretKey,
        apiVersion: this.apiVersion,
        ...(config.appInfo !== undefined ? { appInfo: config.appInfo } : {}),
      });
    this.#now = internals.now ?? (() => new Date());
  }

  async createCustomer(input: CreateProviderCustomerInput): Promise<CreateProviderCustomerResult> {
    assertProviderSupportsCustomerVault(this.capabilities);
    const options = createStripeRequestOptions({
      provider: this.code,
      idempotencyKey: input.idempotencyKey,
      providerAccount: input.providerAccount,
    });

    try {
      const customer = await this.#client.customers.create(
        {
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.metadata !== undefined ? { metadata: { ...input.metadata } } : {}),
        },
        options,
      );
      return createProviderCustomerResult({
        providerCustomerReference: createProviderCustomerReference({
          provider: this.code,
          id: customer.id,
        }),
        observedAt: this.#now(),
      });
    } catch (error) {
      normalizeStripeError(error);
    }
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<ProviderPaymentObservation> {
    if (input.captureMethod === CAPTURE_METHODS.MANUAL) {
      assertProviderSupportsManualCapture(this.capabilities);
    }
    if (input.customer !== undefined) {
      assertProviderOwns(this.code, input.customer);
    }
    if (input.paymentMethod !== undefined) {
      assertProviderOwns(this.code, input.paymentMethod);
    }

    const options = createStripeRequestOptions({
      provider: this.code,
      idempotencyKey: input.idempotencyKey,
      providerAccount: input.providerAccount,
    });

    try {
      const intent = await this.#client.paymentIntents.create(
        {
          amount: toStripeAmount(input.amount.amount),
          currency: toStripeCurrency(input.amount.currency),
          capture_method: input.captureMethod === CAPTURE_METHODS.MANUAL ? 'manual' : 'automatic',
          ...(input.customer !== undefined ? { customer: input.customer.id } : {}),
          ...(input.paymentMethod !== undefined
            ? { payment_method: input.paymentMethod.id, confirm: true, off_session: true }
            : {}),
          ...(input.metadata !== undefined ? { metadata: { ...input.metadata } } : {}),
        },
        options,
      );
      return this.observe(intent, 'create');
    } catch (error) {
      if (isStripeBusinessPaymentError(error)) {
        const intent = stripeErrorPaymentIntent(error);
        if (intent !== undefined) {
          return this.observe(intent, 'create');
        }
      }
      normalizeStripeError(error);
    }
  }

  async capturePayment(input: CaptureProviderPaymentInput): Promise<ProviderPaymentObservation> {
    assertProviderOwns(this.code, input.providerPaymentReference);
    const options = createStripeRequestOptions({
      provider: this.code,
      idempotencyKey: input.idempotencyKey,
      providerAccount: input.providerAccount,
    });
    const retrieveOptions = createStripeRequestOptions({
      provider: this.code,
      providerAccount: input.providerAccount,
    });

    try {
      const current = await this.#client.paymentIntents.retrieve(
        input.providerPaymentReference.id,
        {},
        retrieveOptions,
      );
      this.assertCaptureAllowed(current, input.amount);
      const intent = await this.#client.paymentIntents.capture(
        input.providerPaymentReference.id,
        { amount_to_capture: toStripeAmount(input.amount.amount) },
        options,
      );
      return this.observe(intent, 'capture');
    } catch (error) {
      if (isStripeBusinessPaymentError(error)) {
        const intent = stripeErrorPaymentIntent(error);
        if (intent !== undefined) {
          return this.observe(intent, 'capture');
        }
      }
      normalizeStripeError(error);
    }
  }

  async cancelPayment(input: CancelProviderPaymentInput): Promise<ProviderPaymentObservation> {
    assertProviderSupportsManualCapture(this.capabilities);
    assertProviderOwns(this.code, input.providerPaymentReference);
    const options = createStripeRequestOptions({
      provider: this.code,
      idempotencyKey: input.idempotencyKey,
      providerAccount: input.providerAccount,
    });

    try {
      const intent = await this.#client.paymentIntents.cancel(
        input.providerPaymentReference.id,
        {},
        options,
      );
      return this.observe(intent, 'cancel');
    } catch (error) {
      normalizeStripeError(error);
    }
  }

  async refundPayment(input: RefundProviderPaymentInput): Promise<ProviderRefundResult> {
    assertProviderOwns(this.code, input.providerPaymentReference);
    const options = createStripeRequestOptions({
      provider: this.code,
      idempotencyKey: input.idempotencyKey,
      providerAccount: input.providerAccount,
    });
    const retrieveOptions = createStripeRequestOptions({
      provider: this.code,
      providerAccount: input.providerAccount,
    });
    const stripeReason = mapStripeRefundReason(input.reason);

    try {
      const current = await this.#client.paymentIntents.retrieve(
        input.providerPaymentReference.id,
        {},
        retrieveOptions,
      );
      this.assertRefundAllowed(current, input.amount);
      const refund = await this.#client.refunds.create(
        {
          payment_intent: input.providerPaymentReference.id,
          amount: toStripeAmount(input.amount.amount),
          ...(stripeReason !== undefined ? { reason: stripeReason } : {}),
        },
        options,
      );
      return observeStripeRefund({ refund, observedAt: this.#now() });
    } catch (error) {
      normalizeStripeError(error);
    }
  }

  async retrievePayment(
    input: RetrieveProviderPaymentInput,
  ): Promise<RetrieveProviderPaymentResult> {
    assertProviderOwns(this.code, input.providerPaymentReference);
    const options = createStripeRequestOptions({
      provider: this.code,
      providerAccount: input.providerAccount,
    });

    try {
      const intent = await this.#client.paymentIntents.retrieve(
        input.providerPaymentReference.id,
        {},
        options,
      );
      return retrieveStripePaymentIntent({ intent, observedAt: this.#now() });
    } catch (error) {
      normalizeStripeError(error);
    }
  }

  private observe(
    intent: StripePaymentIntentSnapshot,
    operation: 'create' | 'capture' | 'cancel' | 'retrieve',
  ): ProviderPaymentObservation {
    return observeStripePaymentIntent({
      intent,
      operation,
      observedAt: this.#now(),
    });
  }

  private assertCaptureAllowed(intent: StripePaymentIntentSnapshot, amount: Money): void {
    const requested = moneyFromStripe(intent.amount, intent.currency);
    assertCurrencyMatch(requested, amount, 'Capture currency must match the payment currency.');

    const capturable = fromStripeAmount(intent.amount_capturable);
    const received = fromStripeAmount(intent.amount_received);

    if (received > 0n && capturable > 0n) {
      throw new UnsupportedProviderCapabilityError('multipleCapture');
    }
    if (capturable <= 0n) {
      throw new ProviderContractError('There is no capturable amount on the provider payment.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    if (amount.amount > capturable) {
      throw new ProviderContractError('Capture amount cannot exceed the capturable amount.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    if (amount.amount < capturable) {
      assertProviderSupportsPartialCapture(this.capabilities);
    }
  }

  private assertRefundAllowed(intent: StripePaymentIntentSnapshot, amount: Money): void {
    const requested = moneyFromStripe(intent.amount, intent.currency);
    assertCurrencyMatch(requested, amount, 'Refund currency must match the payment currency.');

    const captured = fromStripeAmount(intent.amount_received);
    if (captured <= 0n) {
      throw new ProviderContractError('Refund requires a captured amount.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    if (amount.amount > captured) {
      throw new ProviderContractError('Refund amount cannot exceed the captured amount.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    if (amount.amount < captured) {
      assertProviderSupportsPartialRefund(this.capabilities);
    } else {
      assertProviderSupportsFullRefund(this.capabilities);
    }
  }
}
