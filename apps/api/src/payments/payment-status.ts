import {
  PaymentCaptureMethod,
  PaymentFailureCategory,
  PaymentStatus,
} from '@fraterunion-payments/database';
import {
  CAPTURE_METHODS,
  PAYMENT_FAILURE_CATEGORIES,
  PAYMENT_STATES,
  type CaptureMethod,
  type PaymentFailureCategory as DomainFailureCategory,
  type PaymentState,
} from '@fraterunion-payments/payment-core';

const DOMAIN_TO_PERSISTED_STATUS: Readonly<Record<PaymentState, PaymentStatus>> = {
  CREATED: PaymentStatus.CREATED,
  REQUIRES_PAYMENT_METHOD: PaymentStatus.REQUIRES_PAYMENT_METHOD,
  REQUIRES_ACTION: PaymentStatus.REQUIRES_ACTION,
  AUTHORIZING: PaymentStatus.AUTHORIZING,
  AUTHORIZED: PaymentStatus.AUTHORIZED,
  CAPTURING: PaymentStatus.CAPTURING,
  SUCCEEDED: PaymentStatus.SUCCEEDED,
  FAILED: PaymentStatus.FAILED,
  CANCELED: PaymentStatus.CANCELED,
  PARTIALLY_REFUNDED: PaymentStatus.PARTIALLY_REFUNDED,
  REFUNDED: PaymentStatus.REFUNDED,
};

const PERSISTED_TO_DOMAIN_STATUS: Readonly<Record<PaymentStatus, PaymentState>> = {
  [PaymentStatus.CREATED]: PAYMENT_STATES.CREATED,
  [PaymentStatus.REQUIRES_PAYMENT_METHOD]: PAYMENT_STATES.REQUIRES_PAYMENT_METHOD,
  [PaymentStatus.REQUIRES_ACTION]: PAYMENT_STATES.REQUIRES_ACTION,
  [PaymentStatus.AUTHORIZING]: PAYMENT_STATES.AUTHORIZING,
  [PaymentStatus.AUTHORIZED]: PAYMENT_STATES.AUTHORIZED,
  [PaymentStatus.CAPTURING]: PAYMENT_STATES.CAPTURING,
  [PaymentStatus.SUCCEEDED]: PAYMENT_STATES.SUCCEEDED,
  [PaymentStatus.FAILED]: PAYMENT_STATES.FAILED,
  [PaymentStatus.CANCELED]: PAYMENT_STATES.CANCELED,
  [PaymentStatus.PARTIALLY_REFUNDED]: PAYMENT_STATES.PARTIALLY_REFUNDED,
  [PaymentStatus.REFUNDED]: PAYMENT_STATES.REFUNDED,
};

const DOMAIN_TO_PERSISTED_CAPTURE: Readonly<Record<CaptureMethod, PaymentCaptureMethod>> = {
  AUTOMATIC: PaymentCaptureMethod.AUTOMATIC,
  MANUAL: PaymentCaptureMethod.MANUAL,
};

const PERSISTED_TO_DOMAIN_CAPTURE: Readonly<Record<PaymentCaptureMethod, CaptureMethod>> = {
  [PaymentCaptureMethod.AUTOMATIC]: CAPTURE_METHODS.AUTOMATIC,
  [PaymentCaptureMethod.MANUAL]: CAPTURE_METHODS.MANUAL,
};

const DOMAIN_TO_PERSISTED_FAILURE: Readonly<Record<DomainFailureCategory, PaymentFailureCategory>> =
  {
    DECLINED: PaymentFailureCategory.DECLINED,
    AUTHENTICATION: PaymentFailureCategory.AUTHENTICATION,
    INSUFFICIENT_FUNDS: PaymentFailureCategory.INSUFFICIENT_FUNDS,
    INVALID_PAYMENT_METHOD: PaymentFailureCategory.INVALID_PAYMENT_METHOD,
    PROCESSING: PaymentFailureCategory.PROCESSING,
    PROVIDER: PaymentFailureCategory.PROVIDER,
    UNKNOWN: PaymentFailureCategory.UNKNOWN,
  };

const PERSISTED_TO_DOMAIN_FAILURE: Readonly<Record<PaymentFailureCategory, DomainFailureCategory>> =
  {
    [PaymentFailureCategory.DECLINED]: PAYMENT_FAILURE_CATEGORIES.DECLINED,
    [PaymentFailureCategory.AUTHENTICATION]: PAYMENT_FAILURE_CATEGORIES.AUTHENTICATION,
    [PaymentFailureCategory.INSUFFICIENT_FUNDS]: PAYMENT_FAILURE_CATEGORIES.INSUFFICIENT_FUNDS,
    [PaymentFailureCategory.INVALID_PAYMENT_METHOD]:
      PAYMENT_FAILURE_CATEGORIES.INVALID_PAYMENT_METHOD,
    [PaymentFailureCategory.PROCESSING]: PAYMENT_FAILURE_CATEGORIES.PROCESSING,
    [PaymentFailureCategory.PROVIDER]: PAYMENT_FAILURE_CATEGORIES.PROVIDER,
    [PaymentFailureCategory.UNKNOWN]: PAYMENT_FAILURE_CATEGORIES.UNKNOWN,
  };

export function toPersistedPaymentStatus(status: PaymentState): PaymentStatus {
  return DOMAIN_TO_PERSISTED_STATUS[status];
}

export function toDomainPaymentStatus(status: PaymentStatus): PaymentState {
  return PERSISTED_TO_DOMAIN_STATUS[status];
}

export function toPersistedCaptureMethod(method: CaptureMethod): PaymentCaptureMethod {
  return DOMAIN_TO_PERSISTED_CAPTURE[method];
}

export function toDomainCaptureMethod(method: PaymentCaptureMethod): CaptureMethod {
  return PERSISTED_TO_DOMAIN_CAPTURE[method];
}

export function toPersistedFailureCategory(
  category: DomainFailureCategory,
): PaymentFailureCategory {
  return DOMAIN_TO_PERSISTED_FAILURE[category];
}

export function toDomainFailureCategory(category: PaymentFailureCategory): DomainFailureCategory {
  return PERSISTED_TO_DOMAIN_FAILURE[category];
}

export function persistedPaymentStates(): readonly PaymentStatus[] {
  return Object.values(PaymentStatus);
}

export function domainPaymentStates(): readonly PaymentState[] {
  return Object.values(PAYMENT_STATES);
}
