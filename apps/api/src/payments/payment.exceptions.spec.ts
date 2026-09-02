import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import { InvalidPaymentTransitionError } from '@fraterunion-payments/payment-core';
import { ERROR_CODES } from '../common/constants/error-codes.constants';
import {
  isIdempotencyUnique,
  mapPaymentDomainError,
  mapPaymentPrismaError,
} from './payment.exceptions';

describe('payment error mapping', () => {
  it('maps payment-core transition errors without leaking the domain class name to HTTP', () => {
    const mapped = mapPaymentDomainError(
      new InvalidPaymentTransitionError('Payment cannot transition from AUTHORIZED to CREATED.'),
    );
    expect(mapped?.code).toBe(ERROR_CODES.PAYMENT_INVALID_TRANSITION);
    expect(mapped?.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(mapped?.message).not.toMatch(/prisma|P20/i);
  });

  it('treats the payment-create idempotency unique index as replay, not a mapped HTTP error', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: 'payment_create_idempotency_org_key_uidx' },
    });
    expect(isIdempotencyUnique(error)).toBe(true);
    expect(mapPaymentPrismaError(error)).toBeUndefined();
  });

  it('maps a customer FK violation to a safe not-found', () => {
    const error = new Prisma.PrismaClientKnownRequestError('FK', {
      code: 'P2003',
      clientVersion: 'test',
      meta: { field_name: 'customer_id' },
    });
    const mapped = mapPaymentPrismaError(error);
    expect(mapped?.code).toBe(ERROR_CODES.PAYMENT_CUSTOMER_NOT_FOUND);
    expect(mapped?.message).not.toMatch(/prisma|fkey/i);
  });
});
