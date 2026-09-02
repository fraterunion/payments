import { PaymentFailureCategory, RefundReason, RefundStatus } from '@fraterunion-payments/database';
import {
  PAYMENT_FAILURE_CATEGORIES,
  REFUND_REASONS,
  REFUND_STATES,
  type PaymentFailureCategory as DomainFailureCategory,
  type RefundReason as DomainRefundReason,
  type RefundState,
} from '@fraterunion-payments/payment-core';

const DOMAIN_TO_PERSISTED_STATUS: Readonly<Record<RefundState, RefundStatus>> = {
  CREATED: RefundStatus.CREATED,
  PROCESSING: RefundStatus.PROCESSING,
  SUCCEEDED: RefundStatus.SUCCEEDED,
  FAILED: RefundStatus.FAILED,
};

const PERSISTED_TO_DOMAIN_STATUS: Readonly<Record<RefundStatus, RefundState>> = {
  [RefundStatus.CREATED]: REFUND_STATES.CREATED,
  [RefundStatus.PROCESSING]: REFUND_STATES.PROCESSING,
  [RefundStatus.SUCCEEDED]: REFUND_STATES.SUCCEEDED,
  [RefundStatus.FAILED]: REFUND_STATES.FAILED,
};

const DOMAIN_TO_PERSISTED_REASON: Readonly<Record<DomainRefundReason, RefundReason>> = {
  CUSTOMER_REQUEST: RefundReason.CUSTOMER_REQUEST,
  DUPLICATE: RefundReason.DUPLICATE,
  FRAUDULENT: RefundReason.FRAUDULENT,
  PRODUCT_OR_SERVICE: RefundReason.PRODUCT_OR_SERVICE,
  OTHER: RefundReason.OTHER,
};

const PERSISTED_TO_DOMAIN_REASON: Readonly<Record<RefundReason, DomainRefundReason>> = {
  [RefundReason.CUSTOMER_REQUEST]: REFUND_REASONS.CUSTOMER_REQUEST,
  [RefundReason.DUPLICATE]: REFUND_REASONS.DUPLICATE,
  [RefundReason.FRAUDULENT]: REFUND_REASONS.FRAUDULENT,
  [RefundReason.PRODUCT_OR_SERVICE]: REFUND_REASONS.PRODUCT_OR_SERVICE,
  [RefundReason.OTHER]: REFUND_REASONS.OTHER,
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

export function toPersistedRefundStatus(status: RefundState): RefundStatus {
  return DOMAIN_TO_PERSISTED_STATUS[status];
}

export function toDomainRefundStatus(status: RefundStatus): RefundState {
  return PERSISTED_TO_DOMAIN_STATUS[status];
}

export function toPersistedRefundReason(reason: DomainRefundReason): RefundReason {
  return DOMAIN_TO_PERSISTED_REASON[reason];
}

export function toDomainRefundReason(reason: RefundReason): DomainRefundReason {
  return PERSISTED_TO_DOMAIN_REASON[reason];
}

export function toPersistedRefundFailureCategory(
  category: DomainFailureCategory,
): PaymentFailureCategory {
  return DOMAIN_TO_PERSISTED_FAILURE[category];
}

export function toDomainRefundFailureCategory(
  category: PaymentFailureCategory,
): DomainFailureCategory {
  return PERSISTED_TO_DOMAIN_FAILURE[category];
}

export function persistedRefundStates(): readonly RefundStatus[] {
  return Object.values(RefundStatus);
}

export function domainRefundStates(): readonly RefundState[] {
  return Object.values(REFUND_STATES);
}

export function persistedRefundReasons(): readonly RefundReason[] {
  return Object.values(RefundReason);
}

export function domainRefundReasons(): readonly DomainRefundReason[] {
  return Object.values(REFUND_REASONS);
}
