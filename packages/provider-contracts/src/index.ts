export const PROVIDER_CONTRACTS_PACKAGE_NAME = '@fraterunion-payments/provider-contracts' as const;

export {
  assertProviderSupports,
  assertProviderSupportsCustomerVault,
  assertProviderSupportsFullRefund,
  assertProviderSupportsManualCapture,
  assertProviderSupportsMultipleCapture,
  assertProviderSupportsPartialCapture,
  assertProviderSupportsPartialRefund,
  createProviderCapabilities,
  PROVIDER_CAPABILITY_KEYS,
} from './capabilities.js';
export type { ProviderCapabilities, ProviderCapabilityKey } from './capabilities.js';

export {
  DuplicateProviderRegistrationError,
  isProviderContractError,
  ProviderAuthenticationError,
  ProviderConfigurationError,
  ProviderContractError,
  PROVIDER_ERROR_CODES,
  ProviderMismatchError,
  ProviderRateLimitError,
  ProviderRegistryFrozenError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  UnknownProviderError,
  UnsupportedProviderCapabilityError,
} from './errors.js';
export type { ProviderContractErrorOptions, ProviderErrorCode } from './errors.js';

export { asProviderIdempotencyKey, PROVIDER_IDEMPOTENCY_KEY_MAX_LENGTH } from './idempotency.js';
export type { ProviderIdempotencyKey } from './idempotency.js';

export {
  createProviderMetadata,
  PROVIDER_METADATA_MAX_KEY_LENGTH,
  PROVIDER_METADATA_MAX_KEYS,
  PROVIDER_METADATA_MAX_VALUE_LENGTH,
} from './metadata.js';
export type { ProviderMetadata } from './metadata.js';

export {
  createProviderCustomerResult,
  createProviderPaymentObservation,
  createProviderRefundResult,
  createRetrieveProviderPaymentResult,
} from './operations.js';
export type {
  CancelProviderPaymentInput,
  CaptureProviderPaymentInput,
  CreateProviderCustomerInput,
  CreateProviderCustomerResult,
  CreateProviderPaymentInput,
  ProviderPaymentObservation,
  ProviderRefundResult,
  RefundProviderPaymentInput,
  RetrieveProviderPaymentInput,
  RetrieveProviderPaymentResult,
} from './operations.js';

export {
  asPaymentProviderCode,
  isPaymentProviderCode,
  PROVIDER_CODE_MAX_LENGTH,
} from './provider-code.js';
export type { PaymentProviderCode } from './provider-code.js';

export type { PaymentProvider } from './provider.js';

export {
  assertProviderOwns,
  createProviderAccountReference,
  createProviderCustomerReference,
  createProviderPaymentMethodReference,
  createProviderPaymentReference,
  createProviderRefundReference,
  PROVIDER_RESOURCE_ID_MAX_LENGTH,
} from './references.js';
export type {
  ProviderAccountReference,
  ProviderCustomerReference,
  ProviderOwnedReference,
  ProviderPaymentMethodReference,
  ProviderPaymentReference,
  ProviderRefundReference,
} from './references.js';

export { PaymentProviderRegistry } from './registry.js';
