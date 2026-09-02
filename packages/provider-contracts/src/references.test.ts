import { describe, expect, it } from 'vitest';
import { asPaymentProviderCode } from './provider-code.js';
import {
  assertProviderOwns,
  createProviderAccountReference,
  createProviderCustomerReference,
  createProviderPaymentMethodReference,
  createProviderPaymentReference,
  createProviderRefundReference,
  PROVIDER_RESOURCE_ID_MAX_LENGTH,
} from './references.js';
import { ProviderMismatchError, PROVIDER_ERROR_CODES } from './errors.js';

const PROVIDER = 'example';

describe('provider references', () => {
  it('creates immutable payment, customer, refund, and account references', () => {
    const payment = createProviderPaymentReference({ provider: 'Example', id: '  psp_ref_abc  ' });
    expect(payment).toEqual({ provider: 'example', id: 'psp_ref_abc' });
    expect(Object.isFrozen(payment)).toBe(true);

    expect(createProviderCustomerReference({ provider: PROVIDER, id: 'cus_1' }).id).toBe('cus_1');
    expect(createProviderRefundReference({ provider: PROVIDER, id: 're_1' }).id).toBe('re_1');
    expect(createProviderAccountReference({ provider: PROVIDER, id: 'acct_connected' }).id).toBe(
      'acct_connected',
    );
  });

  it('creates a provider-bound payment-method reference', () => {
    const method = createProviderPaymentMethodReference({
      provider: PROVIDER,
      id: 'pm_tok_9',
      type: 'CARD',
    });
    expect(method).toEqual({ provider: 'example', id: 'pm_tok_9', type: 'CARD' });
    expect(Object.isFrozen(method)).toBe(true);
  });

  it('accepts arbitrary non-UUID provider resource ids', () => {
    expect(createProviderPaymentReference({ provider: PROVIDER, id: 'psp.ref/abc-99' }).id).toBe(
      'psp.ref/abc-99',
    );
  });

  it('rejects empty ids, over-length ids, and control characters', () => {
    expect(() => createProviderPaymentReference({ provider: PROVIDER, id: '' })).toThrow(
      /required/,
    );
    expect(() =>
      createProviderPaymentReference({
        provider: PROVIDER,
        id: 'x'.repeat(PROVIDER_RESOURCE_ID_MAX_LENGTH + 1),
      }),
    ).toThrow(/at most/);
    expect(() => createProviderCustomerReference({ provider: PROVIDER, id: 'cus\u0001' })).toThrow(
      /control characters/,
    );
    expect(() => createProviderAccountReference({ provider: PROVIDER, id: 'acct\n1' })).toThrow(
      /control characters/,
    );
    try {
      createProviderRefundReference({ provider: PROVIDER, id: '' });
    } catch (error) {
      expect(error).toMatchObject({ code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_REFERENCE });
    }
  });

  it('rejects unknown payment-method types', () => {
    expect(() =>
      createProviderPaymentMethodReference({
        provider: PROVIDER,
        id: 'pm_1',
        type: 'PAN' as 'CARD',
      }),
    ).toThrow(/not recognized/);
  });

  it('rejects routing a foreign provider payment method', () => {
    const method = createProviderPaymentMethodReference({
      provider: 'acme',
      id: 'pm_1',
      type: 'CARD',
    });
    expect(() => assertProviderOwns(asPaymentProviderCode('example'), method)).toThrow(
      ProviderMismatchError,
    );
  });
});
