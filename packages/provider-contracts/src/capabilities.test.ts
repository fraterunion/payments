import { describe, expect, it } from 'vitest';
import {
  assertProviderSupports,
  assertProviderSupportsManualCapture,
  assertProviderSupportsPartialCapture,
  assertProviderSupportsPartialRefund,
  createProviderCapabilities,
  PROVIDER_CAPABILITY_KEYS,
} from './capabilities.js';
import { UnsupportedProviderCapabilityError } from './errors.js';

const supported = createProviderCapabilities({
  manualCapture: true,
  partialCapture: true,
  multipleCapture: false,
  fullRefund: true,
  partialRefund: false,
  customerVault: true,
});

describe('ProviderCapabilities', () => {
  it('allows advertised capabilities', () => {
    expect(() => assertProviderSupportsManualCapture(supported)).not.toThrow();
    expect(() => assertProviderSupportsPartialCapture(supported)).not.toThrow();
    expect(() =>
      assertProviderSupports(supported, PROVIDER_CAPABILITY_KEYS.CUSTOMER_VAULT),
    ).not.toThrow();
  });

  it('raises a typed error for unsupported operations', () => {
    expect(() => assertProviderSupportsPartialRefund(supported)).toThrow(
      UnsupportedProviderCapabilityError,
    );
    expect(() =>
      assertProviderSupports(supported, PROVIDER_CAPABILITY_KEYS.MULTIPLE_CAPTURE),
    ).toThrow(/multipleCapture/);
  });
});
