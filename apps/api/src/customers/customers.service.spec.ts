import { CustomerStatus, CustomerType } from '@fraterunion-payments/database';
import { CustomersService } from './customers.service';
import { CustomerArchivedException, CustomerNotFoundException } from './customer.exceptions';

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01934567-89ab-7cde-8f01-23456789abcd',
    organizationId: 'org-1',
    type: CustomerType.INDIVIDUAL,
    status: CustomerStatus.ACTIVE,
    email: 'ada@example.com',
    name: 'Ada',
    phone: null,
    externalReference: 'member-1',
    description: null,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt: null,
    ...overrides,
  };
}

function createService(tx: Record<string, unknown>) {
  const databaseService = {
    getClient: () => ({
      $transaction: (fn: (client: unknown) => unknown) => fn(tx),
      customer: tx['customer'],
    }),
  };
  const auditService = { write: jest.fn().mockResolvedValue({}) };
  const logger = { setContext: jest.fn(), info: jest.fn() };
  return {
    service: new CustomersService(databaseService as never, auditService as never, logger as never),
    auditService,
  };
}

describe('CustomersService', () => {
  const actor = { type: 'USER' as const, userId: 'user-1' };

  it('creates a customer with canonical email and default INDIVIDUAL type', async () => {
    const created = customerRow();
    const tx = { customer: { create: jest.fn().mockResolvedValue(created) } };
    const { service, auditService } = createService(tx);

    const result = await service.create(
      { organizationId: 'org-1', email: '  Ada@Example.COM  ', name: 'Ada' },
      actor,
    );

    expect(result).toBe(created);
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        type: 'INDIVIDUAL',
        email: 'ada@example.com',
        name: 'Ada',
      }),
    });
    expect(auditService.write).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'customer.created',
        metadata: expect.objectContaining({ hasEmail: true, hasPhone: false }),
      }),
    );
  });

  it('rejects updates to archived customers', async () => {
    const tx = {
      customer: {
        findFirst: jest.fn().mockResolvedValue(customerRow({ status: CustomerStatus.ARCHIVED })),
        update: jest.fn(),
      },
    };
    const { service } = createService(tx);
    await expect(service.update('org-1', 'cust-1', { name: 'New' }, actor)).rejects.toBeInstanceOf(
      CustomerArchivedException,
    );
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('is idempotent on archive and does not rewrite archivedAt', async () => {
    const archived = customerRow({
      status: CustomerStatus.ARCHIVED,
      archivedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const tx = {
      customer: { findFirst: jest.fn().mockResolvedValue(archived), update: jest.fn() },
    };
    const { service, auditService } = createService(tx);
    await expect(service.archive('org-1', archived.id, actor)).resolves.toBe(archived);
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('never fetches a customer by id without organization scope', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const { service } = createService({ customer: { findFirst } });
    await expect(service.get('org-1', 'cust-1')).rejects.toBeInstanceOf(CustomerNotFoundException);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'cust-1', organizationId: 'org-1' } });
  });
});
