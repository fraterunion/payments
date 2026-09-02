import { IdempotencyRecordStatus } from '@fraterunion-payments/database';
import { IdempotencyService } from './idempotency.service';
import {
  IdempotencyKeyConflictException,
  IdempotencyOperationInProgressException,
} from './idempotency.exceptions';
import { IDEMPOTENCY_RECORD_STATUSES, IDEMPOTENCY_SCOPES } from './idempotency.types';

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: '01934567-89ab-7cde-8f01-23456789abcd',
    organizationId: 'org-1',
    scope: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
    keyHash: 'a'.repeat(64),
    requestFingerprint: 'b'.repeat(64),
    resourceType: 'payment',
    resourceId: '01934567-89ab-7cde-8f01-23456789abce',
    status: IdempotencyRecordStatus.COMPLETED,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('IdempotencyService', () => {
  const lookup = {
    organizationId: 'org-1',
    scope: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
    keyHash: 'a'.repeat(64),
    requestFingerprint: 'b'.repeat(64),
  };

  it('replays a completed binding with the same fingerprint', async () => {
    const existing = record();
    const client = { idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(existing) } };
    const service = new IdempotencyService();
    await expect(service.resolveReplay(client as never, lookup)).resolves.toEqual(existing);
  });

  it('conflicts when the fingerprint differs', async () => {
    const client = {
      idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(record()) },
    };
    const service = new IdempotencyService();
    await expect(
      service.resolveReplay(client as never, { ...lookup, requestFingerprint: 'c'.repeat(64) }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictException);
  });

  it('does not pretend a completed result exists while IN_PROGRESS', async () => {
    const client = {
      idempotencyRecord: {
        findUnique: jest
          .fn()
          .mockResolvedValue(record({ status: IdempotencyRecordStatus.IN_PROGRESS })),
      },
    };
    const service = new IdempotencyService();
    await expect(service.resolveReplay(client as never, lookup)).rejects.toBeInstanceOf(
      IdempotencyOperationInProgressException,
    );
  });

  it('inserts COMPLETED for atomic create-style binds', async () => {
    const created = record();
    const create = jest.fn().mockResolvedValue(created);
    const client = { idempotencyRecord: { create } };
    const service = new IdempotencyService();
    await service.bindCompleted(client as never, {
      ...lookup,
      resourceType: 'payment',
      resourceId: created.resourceId,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: IdempotencyRecordStatus.COMPLETED,
          scope: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
        }),
      }),
    );
  });

  it('aligns application statuses with the Prisma enum', () => {
    expect([...Object.values(IDEMPOTENCY_RECORD_STATUSES)].sort()).toEqual(
      [...Object.values(IdempotencyRecordStatus)].sort(),
    );
  });
});
