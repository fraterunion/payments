import { describe, expect, it } from 'vitest';
import {
  DuplicateProviderRegistrationError,
  ProviderRegistryFrozenError,
  UnknownProviderError,
} from './errors.js';
import { PaymentProviderRegistry } from './registry.js';
import { createFakePaymentProvider } from './test/fake-provider.js';

describe('PaymentProviderRegistry', () => {
  it('registers, looks up, and lists providers', () => {
    const registry = new PaymentProviderRegistry();
    const example = createFakePaymentProvider({ code: 'example' });
    const acme = createFakePaymentProvider({ code: 'acme' });
    registry.register(example);
    registry.register(acme);

    expect(registry.get('Example')).toBe(example);
    expect(registry.get(example.code).code).toBe(example.code);
    expect(registry.has('acme')).toBe(true);
    expect(registry.listCodes()).toEqual(['example', 'acme']);
    expect(registry.frozen).toBe(false);
  });

  it('rejects a duplicate code', () => {
    const registry = new PaymentProviderRegistry();
    registry.register(createFakePaymentProvider({ code: 'example' }));
    expect(() => registry.register(createFakePaymentProvider({ code: 'example' }))).toThrow(
      DuplicateProviderRegistrationError,
    );
  });

  it('fails lookup of an unknown code', () => {
    const registry = new PaymentProviderRegistry();
    expect(() => registry.get('missing')).toThrow(UnknownProviderError);
  });

  it('freezes registration after startup', () => {
    const registry = new PaymentProviderRegistry();
    registry.register(createFakePaymentProvider({ code: 'example' }));
    registry.freeze();
    expect(registry.frozen).toBe(true);
    expect(() => registry.register(createFakePaymentProvider({ code: 'acme' }))).toThrow(
      ProviderRegistryFrozenError,
    );
    expect(registry.get('example').code).toBe('example');
  });
});
