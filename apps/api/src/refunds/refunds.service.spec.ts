import { RefundStatus } from '@fraterunion-payments/database';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { InvalidPaymentAmountException } from '../payments/payment.exceptions';
import { RefundNotFoundException } from './refund.exceptions';
import { RefundsService } from './refunds.service';

function refundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01934567-89ab-7cde-8f01-23456789abd0',
    organizationId: 'org-1',
    paymentId: 'pay-1',
    status: RefundStatus.CREATED,
    currency: 'USD',
    amount: 5000n,
    reason: null,
    failureCategory: null,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createService(client: Record<string, unknown>) {
  const databaseService = {
    getClient: () => client,
  };
  const auditService = { write: jest.fn().mockResolvedValue({}) };
  const logger = { setContext: jest.fn(), info: jest.fn() };
  return new RefundsService(
    databaseService as never,
    auditService as never,
    logger as never,
    new IdempotencyService(),
  );
}

describe('RefundsService', () => {
  it('never fetches a refund by id without organization scope', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = createService({ refund: { findFirst } });
    await expect(service.get('org-1', 'ref-1')).rejects.toBeInstanceOf(RefundNotFoundException);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'ref-1', organizationId: 'org-1' } });
  });

  it('rejects a non-integer amount before touching the database', async () => {
    const refundCreate = jest.fn();
    const service = createService({
      refund: { create: refundCreate },
      idempotencyRecord: { findUnique: jest.fn() },
    });
    await expect(
      service.create(
        {
          organizationId: '01934567-89ab-7cde-8f01-23456789abce',
          paymentId: '01934567-89ab-7cde-8f01-23456789abcd',
          amount: '50.00',
          idempotencyKey: 'k1',
        },
        { type: 'SYSTEM' },
      ),
    ).rejects.toBeInstanceOf(InvalidPaymentAmountException);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('lists only the requested organization', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'pay-1' });
    const findMany = jest.fn().mockResolvedValue([refundRow()]);
    const service = createService({
      payment: { findFirst },
      refund: { findMany },
    });
    await service.list({
      organizationId: 'org-1',
      paymentId: 'pay-1',
      status: RefundStatus.CREATED,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'pay-1', organizationId: 'org-1' },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          paymentId: 'pay-1',
          status: RefundStatus.CREATED,
        }),
      }),
    );
  });
});
