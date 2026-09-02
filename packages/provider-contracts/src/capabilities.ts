import { UnsupportedProviderCapabilityError } from './errors.js';

export type ProviderCapabilities = {
  readonly manualCapture: boolean;
  readonly partialCapture: boolean;
  readonly multipleCapture: boolean;
  readonly fullRefund: boolean;
  readonly partialRefund: boolean;
  readonly customerVault: boolean;
};

export const PROVIDER_CAPABILITY_KEYS = {
  MANUAL_CAPTURE: 'manualCapture',
  PARTIAL_CAPTURE: 'partialCapture',
  MULTIPLE_CAPTURE: 'multipleCapture',
  FULL_REFUND: 'fullRefund',
  PARTIAL_REFUND: 'partialRefund',
  CUSTOMER_VAULT: 'customerVault',
} as const;

export type ProviderCapabilityKey =
  (typeof PROVIDER_CAPABILITY_KEYS)[keyof typeof PROVIDER_CAPABILITY_KEYS];

export function createProviderCapabilities(input: ProviderCapabilities): ProviderCapabilities {
  return Object.freeze({
    manualCapture: input.manualCapture,
    partialCapture: input.partialCapture,
    multipleCapture: input.multipleCapture,
    fullRefund: input.fullRefund,
    partialRefund: input.partialRefund,
    customerVault: input.customerVault,
  });
}

export function assertProviderSupports(
  capabilities: ProviderCapabilities,
  capability: ProviderCapabilityKey,
): void {
  if (!capabilities[capability]) {
    throw new UnsupportedProviderCapabilityError(capability);
  }
}

export function assertProviderSupportsManualCapture(capabilities: ProviderCapabilities): void {
  assertProviderSupports(capabilities, PROVIDER_CAPABILITY_KEYS.MANUAL_CAPTURE);
}

export function assertProviderSupportsPartialCapture(capabilities: ProviderCapabilities): void {
  assertProviderSupports(capabilities, PROVIDER_CAPABILITY_KEYS.PARTIAL_CAPTURE);
}

export function assertProviderSupportsMultipleCapture(capabilities: ProviderCapabilities): void {
  assertProviderSupports(capabilities, PROVIDER_CAPABILITY_KEYS.MULTIPLE_CAPTURE);
}

export function assertProviderSupportsFullRefund(capabilities: ProviderCapabilities): void {
  assertProviderSupports(capabilities, PROVIDER_CAPABILITY_KEYS.FULL_REFUND);
}

export function assertProviderSupportsPartialRefund(capabilities: ProviderCapabilities): void {
  assertProviderSupports(capabilities, PROVIDER_CAPABILITY_KEYS.PARTIAL_REFUND);
}

export function assertProviderSupportsCustomerVault(capabilities: ProviderCapabilities): void {
  assertProviderSupports(capabilities, PROVIDER_CAPABILITY_KEYS.CUSTOMER_VAULT);
}
