export const PAYMENT_CORE_PACKAGE_NAME = '@fraterunion-payments/payment-core' as const;

export {
  DOMAIN_ERROR_CODES,
  InvalidMoneyError,
  InvalidPaymentTransitionError,
  InvalidRefundError,
  isPaymentDomainError,
  PaymentDomainError,
  PaymentInvariantError,
} from './errors/errors.js';
export type { DomainErrorCode } from './errors/errors.js';

export { PAYMENT_DOMAIN_EVENTS, REFUND_DOMAIN_EVENTS } from './events/event-names.js';

export { asCustomerId, asOrganizationId, asPaymentId, asRefundId } from './ids/ids.js';
export type { CustomerId, OrganizationId, PaymentId, RefundId } from './ids/ids.js';

export { canonicalizeCurrencyCode, isCurrencyCode } from './money/currency.js';
export type { CurrencyCode } from './money/currency.js';
export {
  addMoney,
  assertSameCurrency,
  createMoney,
  moneyEquals,
  moneyFromJSON,
  moneyToJSON,
  subtractMoney,
  zeroMoney,
} from './money/money.js';
export type { Money, MoneyJSON } from './money/money.js';

export { CAPTURE_METHODS } from './payments/capture-method.js';
export type { CaptureMethod } from './payments/capture-method.js';
export { createPaymentFailure, PAYMENT_FAILURE_CATEGORIES } from './payments/failure.js';
export type { PaymentFailure, PaymentFailureCategory } from './payments/failure.js';
export {
  createPaymentMethodReference,
  PAYMENT_ACTION_REQUIREMENT_TYPES,
  PAYMENT_METHOD_TYPES,
} from './payments/payment-method.js';
export type {
  PaymentActionRequirement,
  PaymentActionRequirementType,
  PaymentMethodReference,
  PaymentMethodType,
} from './payments/payment-method.js';
export {
  applyAuthorization,
  applyCapture,
  applyRefund,
  attachPaymentMethod,
  beginAuthorization,
  beginCapture,
  canApplyAuthorization,
  canApplyCapture,
  canBeginAuthorization,
  canBeginCapture,
  canCancelPayment,
  canRefundPayment,
  cancelPayment,
  createPayment,
  derivePaymentRefundState,
  failPayment,
  isFullyCaptured,
  isFullyRefunded,
  isPartiallyCaptured,
  isPartiallyRefunded,
  markRequiresPaymentMethod,
  refundableAmount,
  remainingAuthorizedAmount,
  remainingCapturableAmount,
  requireCustomerAction,
  resumeAuthorization,
} from './payments/payment.js';
export type { CreatePaymentInput, Payment } from './payments/payment.js';
export {
  assertPaymentTransition,
  canTransitionPayment,
  isPaymentExecutionTerminal,
  isPaymentLifecycleClosed,
  isRefundablePaymentState,
  PAYMENT_STATES,
  PAYMENT_TRANSITIONS,
} from './payments/payment-states.js';
export type { PaymentState } from './payments/payment-states.js';

export {
  createProviderCustomerReference,
  createProviderPaymentReference,
} from './providers/provider-reference.js';
export type {
  ProviderCustomerReference,
  ProviderPaymentReference,
} from './providers/provider-reference.js';

export {
  assertRefundFitsCaptured,
  beginRefundProcessing,
  createRefund,
  failRefund,
  REFUND_REASONS,
  REFUND_STATES,
  succeedRefund,
} from './refunds/refund.js';
export type { CreateRefundInput, Refund, RefundReason, RefundState } from './refunds/refund.js';
