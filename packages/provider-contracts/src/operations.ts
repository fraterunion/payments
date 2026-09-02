import type {
  CaptureMethod,
  CustomerId,
  Money,
  OrganizationId,
  PaymentActionRequirement,
  PaymentFailure,
  PaymentId,
  PaymentState,
  RefundId,
  RefundReason,
  RefundState,
} from '@fraterunion-payments/payment-core';
import { PAYMENT_STATES, REFUND_STATES } from '@fraterunion-payments/payment-core';
import { ProviderContractError, PROVIDER_ERROR_CODES } from './errors.js';
import type { ProviderIdempotencyKey } from './idempotency.js';
import type { ProviderMetadata } from './metadata.js';
import type {
  ProviderAccountReference,
  ProviderCustomerReference,
  ProviderPaymentMethodReference,
  ProviderPaymentReference,
  ProviderRefundReference,
} from './references.js';

/**
 * A provider API response is an observation of provider execution at
 * `observedAt`. It is not always the final authoritative settlement state.
 * Webhooks and retrievePayment later converge that observation.
 */
export type ProviderPaymentObservation = {
  readonly providerPaymentReference: ProviderPaymentReference;
  readonly state: PaymentState;
  readonly authorizedAmount?: Money;
  readonly capturedAmount?: Money;
  readonly actionRequirement?: PaymentActionRequirement;
  readonly failure?: PaymentFailure;
  readonly observedAt: Date;
};

export type RetrieveProviderPaymentResult = ProviderPaymentObservation & {
  readonly requestedAmount?: Money;
  readonly refundedAmount?: Money;
};

export type ProviderRefundResult = {
  readonly providerRefundReference: ProviderRefundReference;
  readonly state: RefundState;
  readonly failure?: PaymentFailure;
  readonly observedAt: Date;
};

export type CreateProviderCustomerResult = {
  readonly providerCustomerReference: ProviderCustomerReference;
  readonly observedAt: Date;
};

export type CreateProviderCustomerInput = {
  readonly organizationId: OrganizationId;
  readonly customerReference: CustomerId;
  readonly idempotencyKey: ProviderIdempotencyKey;
  readonly email?: string;
  readonly name?: string;
  readonly metadata?: ProviderMetadata;
  readonly providerAccount?: ProviderAccountReference;
};

export type CreateProviderPaymentInput = {
  readonly organizationId: OrganizationId;
  readonly paymentId: PaymentId;
  readonly amount: Money;
  readonly captureMethod: CaptureMethod;
  readonly idempotencyKey: ProviderIdempotencyKey;
  readonly customer?: ProviderCustomerReference;
  readonly paymentMethod?: ProviderPaymentMethodReference;
  readonly metadata?: ProviderMetadata;
  readonly providerAccount?: ProviderAccountReference;
};

export type CaptureProviderPaymentInput = {
  readonly organizationId: OrganizationId;
  readonly paymentId: PaymentId;
  readonly providerPaymentReference: ProviderPaymentReference;
  readonly amount: Money;
  readonly idempotencyKey: ProviderIdempotencyKey;
  readonly providerAccount?: ProviderAccountReference;
};

export type CancelProviderPaymentInput = {
  readonly organizationId: OrganizationId;
  readonly paymentId: PaymentId;
  readonly providerPaymentReference: ProviderPaymentReference;
  readonly idempotencyKey: ProviderIdempotencyKey;
  readonly providerAccount?: ProviderAccountReference;
};

export type RefundProviderPaymentInput = {
  readonly organizationId: OrganizationId;
  readonly paymentId: PaymentId;
  readonly refundId: RefundId;
  readonly providerPaymentReference: ProviderPaymentReference;
  readonly amount: Money;
  readonly idempotencyKey: ProviderIdempotencyKey;
  readonly reason?: RefundReason;
  readonly providerAccount?: ProviderAccountReference;
};

export type RetrieveProviderPaymentInput = {
  readonly providerPaymentReference: ProviderPaymentReference;
  readonly providerAccount?: ProviderAccountReference;
};

const PAYMENT_STATE_SET: ReadonlySet<string> = new Set(Object.values(PAYMENT_STATES));
const REFUND_STATE_SET: ReadonlySet<string> = new Set(Object.values(REFUND_STATES));

function nowOr(value: Date | undefined): Date {
  return value === undefined ? new Date() : value;
}

export function createProviderPaymentObservation(input: {
  readonly providerPaymentReference: ProviderPaymentReference;
  readonly state: PaymentState;
  readonly authorizedAmount?: Money;
  readonly capturedAmount?: Money;
  readonly actionRequirement?: PaymentActionRequirement;
  readonly failure?: PaymentFailure;
  readonly observedAt?: Date;
}): ProviderPaymentObservation {
  if (!PAYMENT_STATE_SET.has(input.state)) {
    throw new ProviderContractError('Observed payment state is not recognized.', {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
    });
  }
  return Object.freeze({
    providerPaymentReference: input.providerPaymentReference,
    state: input.state,
    observedAt: nowOr(input.observedAt),
    ...(input.authorizedAmount !== undefined ? { authorizedAmount: input.authorizedAmount } : {}),
    ...(input.capturedAmount !== undefined ? { capturedAmount: input.capturedAmount } : {}),
    ...(input.actionRequirement !== undefined
      ? { actionRequirement: input.actionRequirement }
      : {}),
    ...(input.failure !== undefined ? { failure: input.failure } : {}),
  });
}

export function createRetrieveProviderPaymentResult(input: {
  readonly providerPaymentReference: ProviderPaymentReference;
  readonly state: PaymentState;
  readonly requestedAmount?: Money;
  readonly authorizedAmount?: Money;
  readonly capturedAmount?: Money;
  readonly refundedAmount?: Money;
  readonly actionRequirement?: PaymentActionRequirement;
  readonly failure?: PaymentFailure;
  readonly observedAt?: Date;
}): RetrieveProviderPaymentResult {
  const observation = createProviderPaymentObservation(input);
  return Object.freeze({
    ...observation,
    ...(input.requestedAmount !== undefined ? { requestedAmount: input.requestedAmount } : {}),
    ...(input.refundedAmount !== undefined ? { refundedAmount: input.refundedAmount } : {}),
  });
}

export function createProviderRefundResult(input: {
  readonly providerRefundReference: ProviderRefundReference;
  readonly state: RefundState;
  readonly failure?: PaymentFailure;
  readonly observedAt?: Date;
}): ProviderRefundResult {
  if (!REFUND_STATE_SET.has(input.state)) {
    throw new ProviderContractError('Observed refund state is not recognized.', {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
    });
  }
  return Object.freeze({
    providerRefundReference: input.providerRefundReference,
    state: input.state,
    observedAt: nowOr(input.observedAt),
    ...(input.failure !== undefined ? { failure: input.failure } : {}),
  });
}

export function createProviderCustomerResult(input: {
  readonly providerCustomerReference: ProviderCustomerReference;
  readonly observedAt?: Date;
}): CreateProviderCustomerResult {
  return Object.freeze({
    providerCustomerReference: input.providerCustomerReference,
    observedAt: nowOr(input.observedAt),
  });
}
