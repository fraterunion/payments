import { PaymentCaptureMethod, PaymentStatus } from '@fraterunion-payments/database';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaymentsService } from './payments.service';
import { InvalidPaymentAmountException, PaymentNotFoundException } from './payment.exceptions';

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01934567-89ab-7cde-8f01-23456789abcd',
    organizationId: 'org-1',
    customerId: null,
    status: PaymentStatus.CREATED,
    captureMethod: PaymentCaptureMethod.AUTOMATIC,
    currency: 'USD',
    requestedAmount: 12500n,
    authorizedAmount: 0n,
    capturedAmount: 0n,
    refundedAmount: 0n,
    failureCategory: null,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    description: null,
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
  return new PaymentsService(
    databaseService as never,
    auditService as never,
    logger as never,
    new IdempotencyService(),
  );
}

describe('PaymentsService', () => {
  it('never fetches a payment by id without organization scope', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = createService({ payment: { findFirst } });
    await expect(service.get('org-1', 'pay-1')).rejects.toBeInstanceOf(PaymentNotFoundException);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'pay-1', organizationId: 'org-1' } });
  });

  it('rejects a non-integer amount before touching the database', async () => {
    const paymentCreate = jest.fn();
    const service = createService({
      payment: { create: paymentCreate },
      idempotencyRecord: { findUnique: jest.fn() },
    });
    await expect(
      service.create(
        {
          organizationId: '01934567-89ab-7cde-8f01-23456789abce',
          amount: '125.50',
          currency: 'USD',
          captureMethod: PaymentCaptureMethod.AUTOMATIC,
          idempotencyKey: 'k1',
        },
        { type: 'SYSTEM' },
      ),
    ).rejects.toBeInstanceOf(InvalidPaymentAmountException);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('lists only the requested organization', async () => {
    const findMany = jest.fn().mockResolvedValue([paymentRow()]);
    const service = createService({ payment: { findMany } });
    await service.list({ organizationId: 'org-1', status: PaymentStatus.CREATED });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', status: PaymentStatus.CREATED }),
      }),
    );
  });
});
