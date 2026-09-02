import { CAPTURE_METHODS, PAYMENT_STATES, REFUND_STATES } from '@fraterunion-payments/payment-core';
import type { Money } from '@fraterunion-payments/payment-core';
import {
  assertProviderSupportsCustomerVault,
  assertProviderSupportsFullRefund,
  assertProviderSupportsManualCapture,
  assertProviderSupportsMultipleCapture,
  assertProviderSupportsPartialCapture,
  assertProviderSupportsPartialRefund,
  createProviderCapabilities,
  type ProviderCapabilities,
} from '../capabilities.js';
import { ProviderContractError, PROVIDER_ERROR_CODES } from '../errors.js';
import type { ProviderIdempotencyKey } from '../idempotency.js';
import {
  createProviderCustomerResult,
  createProviderPaymentObservation,
  createProviderRefundResult,
  createRetrieveProviderPaymentResult,
  type CancelProviderPaymentInput,
  type CaptureProviderPaymentInput,
  type CreateProviderCustomerInput,
  type CreateProviderCustomerResult,
  type CreateProviderPaymentInput,
  type ProviderPaymentObservation,
  type ProviderRefundResult,
  type RefundProviderPaymentInput,
  type RetrieveProviderPaymentInput,
  type RetrieveProviderPaymentResult,
} from '../operations.js';
import { asPaymentProviderCode, type PaymentProviderCode } from '../provider-code.js';
import type { PaymentProvider } from '../provider.js';
import {
  assertProviderOwns,
  createProviderCustomerReference,
  createProviderPaymentReference,
  createProviderRefundReference,
} from '../references.js';

export type FakePaymentProviderOptions = {
  readonly code?: string;
  readonly capabilities?: Partial<ProviderCapabilities>;
};

type StoredPayment = {
  requestedAmount: Money;
  authorizedAmount?: Money;
  capturedAmount?: Money;
  refundedAmount?: Money;
  observation: ProviderPaymentObservation;
};

const ALL_CAPABILITIES: ProviderCapabilities = {
  manualCapture: true,
  partialCapture: true,
  multipleCapture: true,
  fullRefund: true,
  partialRefund: true,
  customerVault: true,
};

/**
 * In-memory adapter for contract tests only. Not a production provider.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly code: PaymentProviderCode;
  readonly capabilities: ProviderCapabilities;
  readonly lastIdempotencyKeyByOperation = new Map<string, ProviderIdempotencyKey>();

  private readonly payments = new Map<string, StoredPayment>();
  private readonly customers = new Map<string, CreateProviderCustomerResult>();
  private readonly refunds = new Map<string, ProviderRefundResult>();
  private readonly idempotentResults = new Map<string, unknown>();
  private sequence = 0;

  constructor(options: FakePaymentProviderOptions = {}) {
    this.code = asPaymentProviderCode(options.code ?? 'example');
    this.capabilities = createProviderCapabilities({
      ...ALL_CAPABILITIES,
      ...options.capabilities,
    });
  }

  async createCustomer(input: CreateProviderCustomerInput): Promise<CreateProviderCustomerResult> {
    this.recordIdempotency('createCustomer', input.idempotencyKey);
    this.assertAccount(input.providerAccount);
    const cached = this.recall<CreateProviderCustomerResult>(
      'createCustomer',
      input.idempotencyKey,
    );
    if (cached) {
      return cached;
    }
    assertProviderSupportsCustomerVault(this.capabilities);
    const result = createProviderCustomerResult({
      providerCustomerReference: createProviderCustomerReference({
        provider: this.code,
        id: `cus_${this.nextId()}`,
      }),
    });
    this.customers.set(result.providerCustomerReference.id, result);
    this.remember('createCustomer', input.idempotencyKey, result);
    return result;
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<ProviderPaymentObservation> {
    this.recordIdempotency('createPayment', input.idempotencyKey);
    this.assertAccount(input.providerAccount);
    const cached = this.recall<ProviderPaymentObservation>('createPayment', input.idempotencyKey);
    if (cached) {
      return cached;
    }
    if (input.captureMethod === CAPTURE_METHODS.MANUAL) {
      assertProviderSupportsManualCapture(this.capabilities);
    }
    if (input.amount.amount <= 0n) {
      throw new ProviderContractError('Payment amount must be greater than zero.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    if (input.customer) {
      assertProviderOwns(this.code, input.customer);
    }
    if (input.paymentMethod) {
      assertProviderOwns(this.code, input.paymentMethod);
    }

    const providerPaymentReference = createProviderPaymentReference({
      provider: this.code,
      id: `pay_${this.nextId()}`,
    });
    const observation = createProviderPaymentObservation({
      providerPaymentReference,
      state: PAYMENT_STATES.AUTHORIZING,
      authorizedAmount: input.amount,
    });
    this.payments.set(providerPaymentReference.id, {
      requestedAmount: input.amount,
      authorizedAmount: input.amount,
      observation,
    });
    this.remember('createPayment', input.idempotencyKey, observation);
    return observation;
  }

  async capturePayment(input: CaptureProviderPaymentInput): Promise<ProviderPaymentObservation> {
    this.recordIdempotency('capturePayment', input.idempotencyKey);
    this.assertAccount(input.providerAccount);
    const cached = this.recall<ProviderPaymentObservation>('capturePayment', input.idempotencyKey);
    if (cached) {
      return cached;
    }
    assertProviderOwns(this.code, input.providerPaymentReference);
    const stored = this.requirePayment(input.providerPaymentReference.id);
    const authorized = stored.authorizedAmount ?? stored.requestedAmount;
    if (input.amount.amount <= 0n) {
      throw new ProviderContractError('Capture amount must be greater than zero.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    if (input.amount.currency !== authorized.currency) {
      throw new ProviderContractError('Capture currency must match the payment currency.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    if (input.amount.amount < authorized.amount) {
      assertProviderSupportsPartialCapture(this.capabilities);
    }
    if (stored.capturedAmount !== undefined && stored.capturedAmount.amount > 0n) {
      assertProviderSupportsMultipleCapture(this.capabilities);
    }
    if (input.amount.amount > authorized.amount) {
      throw new ProviderContractError('Capture amount cannot exceed authorized amount.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }

    const observation = createProviderPaymentObservation({
      providerPaymentReference: input.providerPaymentReference,
      state: PAYMENT_STATES.SUCCEEDED,
      authorizedAmount: authorized,
      capturedAmount: input.amount,
    });
    stored.capturedAmount = input.amount;
    stored.observation = observation;
    this.remember('capturePayment', input.idempotencyKey, observation);
    return observation;
  }

  async cancelPayment(input: CancelProviderPaymentInput): Promise<ProviderPaymentObservation> {
    this.recordIdempotency('cancelPayment', input.idempotencyKey);
    this.assertAccount(input.providerAccount);
    const cached = this.recall<ProviderPaymentObservation>('cancelPayment', input.idempotencyKey);
    if (cached) {
      return cached;
    }
    assertProviderSupportsManualCapture(this.capabilities);
    assertProviderOwns(this.code, input.providerPaymentReference);
    const stored = this.requirePayment(input.providerPaymentReference.id);
    const observation = createProviderPaymentObservation({
      providerPaymentReference: input.providerPaymentReference,
      state: PAYMENT_STATES.CANCELED,
      ...(stored.authorizedAmount !== undefined
        ? { authorizedAmount: stored.authorizedAmount }
        : {}),
    });
    stored.observation = observation;
    this.remember('cancelPayment', input.idempotencyKey, observation);
    return observation;
  }

  async refundPayment(input: RefundProviderPaymentInput): Promise<ProviderRefundResult> {
    this.recordIdempotency('refundPayment', input.idempotencyKey);
    this.assertAccount(input.providerAccount);
    const cached = this.recall<ProviderRefundResult>('refundPayment', input.idempotencyKey);
    if (cached) {
      return cached;
    }
    assertProviderOwns(this.code, input.providerPaymentReference);
    const stored = this.requirePayment(input.providerPaymentReference.id);
    const captured = stored.capturedAmount;
    if (captured === undefined || captured.amount <= 0n) {
      throw new ProviderContractError('Refund requires a captured amount.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    if (input.amount.amount <= 0n) {
      throw new ProviderContractError('Refund amount must be greater than zero.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    if (input.amount.currency !== captured.currency) {
      throw new ProviderContractError('Refund currency must match the payment currency.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    if (input.amount.amount < captured.amount) {
      assertProviderSupportsPartialRefund(this.capabilities);
    }
    if (input.amount.amount === captured.amount) {
      assertProviderSupportsFullRefund(this.capabilities);
    }
    if (input.amount.amount > captured.amount) {
      throw new ProviderContractError('Refund amount cannot exceed captured amount.', {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }

    const result = createProviderRefundResult({
      providerRefundReference: createProviderRefundReference({
        provider: this.code,
        id: `re_${this.nextId()}`,
      }),
      state: REFUND_STATES.SUCCEEDED,
    });
    stored.refundedAmount = input.amount;
    this.refunds.set(result.providerRefundReference.id, result);
    this.remember('refundPayment', input.idempotencyKey, result);
    return result;
  }

  async retrievePayment(
    input: RetrieveProviderPaymentInput,
  ): Promise<RetrieveProviderPaymentResult> {
    this.assertAccount(input.providerAccount);
    assertProviderOwns(this.code, input.providerPaymentReference);
    const stored = this.requirePayment(input.providerPaymentReference.id);
    return createRetrieveProviderPaymentResult({
      providerPaymentReference: input.providerPaymentReference,
      state: stored.observation.state,
      requestedAmount: stored.requestedAmount,
      ...(stored.authorizedAmount !== undefined
        ? { authorizedAmount: stored.authorizedAmount }
        : {}),
      ...(stored.capturedAmount !== undefined ? { capturedAmount: stored.capturedAmount } : {}),
      ...(stored.refundedAmount !== undefined ? { refundedAmount: stored.refundedAmount } : {}),
      ...(stored.observation.failure !== undefined ? { failure: stored.observation.failure } : {}),
      observedAt: new Date(),
    });
  }

  private assertAccount(account: CreateProviderPaymentInput['providerAccount']): void {
    if (account !== undefined) {
      assertProviderOwns(this.code, account);
    }
  }

  private requirePayment(id: string): StoredPayment {
    const stored = this.payments.get(id);
    if (stored === undefined) {
      throw new ProviderContractError(`Unknown provider payment "${id}".`, {
        code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
      });
    }
    return stored;
  }

  private recordIdempotency(operation: string, key: ProviderIdempotencyKey): void {
    this.lastIdempotencyKeyByOperation.set(operation, key);
  }

  private remember(operation: string, key: ProviderIdempotencyKey, result: unknown): void {
    this.idempotentResults.set(`${operation}:${key}`, result);
  }

  private recall<T>(operation: string, key: ProviderIdempotencyKey): T | undefined {
    return this.idempotentResults.get(`${operation}:${key}`) as T | undefined;
  }

  private nextId(): string {
    this.sequence += 1;
    return `${this.sequence}`;
  }
}

export function createFakePaymentProvider(
  options: FakePaymentProviderOptions = {},
): FakePaymentProvider {
  return new FakePaymentProvider(options);
}
