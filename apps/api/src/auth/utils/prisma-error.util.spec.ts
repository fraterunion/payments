import { Prisma } from '@fraterunion-payments/database';
import { isUniqueConstraintViolation } from './prisma-error.util';

function uniqueViolation(meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    ...(meta === undefined ? {} : { meta }),
  });
}

describe('isUniqueConstraintViolation', () => {
  it('is true for an exact-column unique violation', () => {
    expect(isUniqueConstraintViolation(uniqueViolation({ target: ['email'] }))).toBe(true);
  });

  it('is true for the functional LOWER(email) unique index Prisma reports as P2002', () => {
    expect(
      isUniqueConstraintViolation(
        uniqueViolation({
          modelName: 'User',
          target: ['lower(email::text'],
        }),
      ),
    ).toBe(true);
  });

  it('is false for other Prisma errors and non-Prisma values', () => {
    expect(
      isUniqueConstraintViolation(
        new Prisma.PrismaClientKnownRequestError('not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      ),
    ).toBe(false);
    expect(isUniqueConstraintViolation(new Error('duplicate'))).toBe(false);
    expect(isUniqueConstraintViolation(undefined)).toBe(false);
  });
});
