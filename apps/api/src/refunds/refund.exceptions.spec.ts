import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import { InvalidRefundError } from '@fraterunion-payments/payment-core';
import { ERROR_CODES } from '../common/constants/error-codes.constants';
import { isIdempotencyUnique } from '../idempotency/idempotency.exceptions';
import { mapRefundDomainError, mapRefundPrismaError } from './refund.exceptions';

describe('refund error mapping', () => {
  it('maps over-refund domain errors to REFUND_AMOUNT_EXCEEDS_AVAILABLE', () => {
    const mapped = mapRefundDomainError(
      new InvalidRefundError(
        'Successful plus reserved refunds cannot exceed capturedAmount.',
        'REFUND_EXCEEDS_CAPTURED_AMOUNT',
      ),
    );
    expect(mapped?.code).toBe(ERROR_CODES.REFUND_AMOUNT_EXCEEDS_AVAILABLE);
    expect(mapped?.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(mapped?.message).not.toMatch(/prisma|P20/i);
  });

  it('maps invalid refund transitions without leaking domain class names', () => {
    const mapped = mapRefundDomainError(
      new InvalidRefundError('Cannot succeed a refund in state FAILED.'),
    );
    expect(mapped?.code).toBe(ERROR_CODES.REFUND_INVALID_TRANSITION);
    expect(mapped?.message).not.toMatch(/InvalidRefundError|prisma/i);
  });

  it('treats the financial idempotency unique index as replay', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: 'idempotency_records_org_scope_key_uidx' },
    });
    expect(isIdempotencyUnique(error)).toBe(true);
    expect(mapRefundPrismaError(error)).toBeUndefined();
  });
});
