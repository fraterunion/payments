import {
  asProviderIdempotencyKey,
  PROVIDER_IDEMPOTENCY_KEY_MAX_LENGTH,
} from '@fraterunion-payments/provider-contracts';
import { IDEMPOTENCY_SCOPES } from './idempotency.types';
import { deriveProviderIdempotencyKey } from './provider-idempotency-key';

const OPERATION_ID = '01934567-89ab-7cde-8f01-23456789abcd';

describe('deriveProviderIdempotencyKey', () => {
  it('is deterministic for the same provider, operation, and operationId', () => {
    const left = deriveProviderIdempotencyKey({
      provider: 'stripe',
      operation: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
      operationId: OPERATION_ID,
    });
    const right = deriveProviderIdempotencyKey({
      provider: 'stripe',
      operation: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
      operationId: OPERATION_ID.toUpperCase(),
    });
    expect(left).toBe(right);
    expect(asProviderIdempotencyKey(left)).toBe(left);
    expect(left.length).toBeLessThanOrEqual(PROVIDER_IDEMPOTENCY_KEY_MAX_LENGTH);
    expect(left.startsWith('fup:')).toBe(true);
  });

  it('changes when provider, operation, or operationId changes', () => {
    const base = deriveProviderIdempotencyKey({
      provider: 'stripe',
      operation: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
      operationId: OPERATION_ID,
    });
    expect(
      deriveProviderIdempotencyKey({
        provider: 'adyen',
        operation: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
        operationId: OPERATION_ID,
      }),
    ).not.toBe(base);
    expect(
      deriveProviderIdempotencyKey({
        provider: 'stripe',
        operation: IDEMPOTENCY_SCOPES.PAYMENT_CANCEL,
        operationId: OPERATION_ID,
      }),
    ).not.toBe(base);
    expect(
      deriveProviderIdempotencyKey({
        provider: 'stripe',
        operation: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
        operationId: '01934567-89ab-7cde-8f01-23456789abce',
      }),
    ).not.toBe(base);
  });

  it('never includes a client Idempotency-Key', () => {
    const clientKey = 'client-secret-idempotency-key';
    const derived = deriveProviderIdempotencyKey({
      provider: 'stripe',
      operation: IDEMPOTENCY_SCOPES.REFUND_EXECUTE,
      operationId: OPERATION_ID,
    });
    expect(derived).not.toContain(clientKey);
    expect(derived).not.toContain('Idempotency-Key');
  });
});
