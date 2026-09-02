import { Prisma } from '@fraterunion-payments/database';
import { ERROR_CODES } from '../common/constants/error-codes.constants';
import {
  IdempotencyKeyConflictException,
  IdempotencyOperationInProgressException,
  isIdempotencyUnique,
} from './idempotency.exceptions';

describe('idempotency exceptions', () => {
  it('does not leak fingerprints, hashes, or constraint names on conflict', () => {
    const error = new IdempotencyKeyConflictException();
    expect(error.code).toBe(ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT);
    expect(error.message).not.toMatch(/fingerprint|sha-?256|p2002|constraint/i);
  });

  it('treats in-progress as a retryable conflict without a completed result', () => {
    const error = new IdempotencyOperationInProgressException();
    expect(error.code).toBe(ERROR_CODES.IDEMPOTENCY_OPERATION_IN_PROGRESS);
    expect(error.getStatus()).toBe(409);
    expect(error.message).not.toMatch(/fingerprint|hash|p2002/i);
  });

  it('recognizes both org-scope-key and scope-resource unique indexes', () => {
    const orgScope = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: 'idempotency_records_org_scope_key_uidx' },
    });
    const scopeResource = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: 'idempotency_records_scope_resource_uidx' },
    });
    expect(isIdempotencyUnique(orgScope)).toBe(true);
    expect(isIdempotencyUnique(scopeResource)).toBe(true);
  });
});
