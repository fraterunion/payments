import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import { assertStripeSecretKeyMode } from './secret-key.js';

describe('assertStripeSecretKeyMode', () => {
  it('refuses live keys when live is not allowed and never echoes the secret', () => {
    try {
      assertStripeSecretKeyMode('sk_live_super_secret_material', { allowLive: false });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderConfigurationError);
      expect((error as Error).message).not.toContain('sk_live_');
      expect((error as Error).message).not.toContain('super_secret_material');
    }
  });

  it('allows test keys and live keys only when explicitly permitted', () => {
    expect(() =>
      assertStripeSecretKeyMode('sk_test_not_a_real_key', { allowLive: false }),
    ).not.toThrow();
    expect(() =>
      assertStripeSecretKeyMode('sk_live_not_a_real_key', { allowLive: true }),
    ).not.toThrow();
  });
});
