import { CustomerStatus } from '@fraterunion-payments/database';
import { CustomerProviderMappingsService } from './customer-provider-mappings.service';
import { CustomerArchivedException, CustomerNotFoundException } from './customer.exceptions';

function createService(tx: Record<string, unknown>) {
  const databaseService = {
    getClient: () => ({
      $transaction: (fn: (client: unknown) => unknown) => fn(tx),
      customer: tx['customer'],
      customerProviderMapping: tx['customerProviderMapping'],
    }),
  };
  const auditService = { write: jest.fn().mockResolvedValue({}) };
  const logger = { setContext: jest.fn(), info: jest.fn() };
  return {
    service: new CustomerProviderMappingsService(
      databaseService as never,
      auditService as never,
      logger as never,
    ),
    auditService,
  };
}

describe('CustomerProviderMappingsService', () => {
  const actor = { type: 'SYSTEM' as const };

  it('creates a mapping with a default account scope and opaque provider id', async () => {
    const created = {
      id: 'map-1',
      organizationId: 'org-1',
      customerId: 'cust-1',
      provider: 'example',
      providerAccountReference: null,
      providerAccountScope: 'default',
      providerCustomerId: 'psp.ref/abc',
    };
    const tx = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cust-1', status: CustomerStatus.ACTIVE }),
      },
      customerProviderMapping: { create: jest.fn().mockResolvedValue(created) },
    };
    const { service, auditService } = createService(tx);

    await service.create(
      {
        organizationId: 'org-1',
        customerId: 'cust-1',
        provider: 'Example',
        providerCustomerId: 'psp.ref/abc',
      },
      actor,
    );

    expect(tx.customerProviderMapping.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'example',
        providerAccountScope: 'default',
        providerCustomerId: 'psp.ref/abc',
      }),
    });
    expect(auditService.write).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'customer.provider_mapping_created',
        metadata: expect.objectContaining({ provider: 'example', providerAccountPresent: false }),
      }),
    );
  });

  it('rejects mappings on archived customers', async () => {
    const tx = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cust-1', status: CustomerStatus.ARCHIVED }),
      },
      customerProviderMapping: { create: jest.fn() },
    };
    const { service } = createService(tx);
    await expect(
      service.create(
        {
          organizationId: 'org-1',
          customerId: 'cust-1',
          provider: 'example',
          providerCustomerId: 'cus_1',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(CustomerArchivedException);
  });

  it('rejects a customer that is not in the organization', async () => {
    const tx = {
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
      customerProviderMapping: { create: jest.fn() },
    };
    const { service } = createService(tx);
    await expect(
      service.create(
        {
          organizationId: 'org-1',
          customerId: 'cust-other',
          provider: 'example',
          providerCustomerId: 'cus_1',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(CustomerNotFoundException);
  });
});
