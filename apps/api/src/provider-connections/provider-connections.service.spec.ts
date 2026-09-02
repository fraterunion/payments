import { ProviderAccountConnectionStatus } from '@fraterunion-payments/database';
import { PROVIDER_ACCOUNT_STATUSES } from '@fraterunion-payments/provider-stripe';
import { toProviderConnectionResponse } from './provider-connections.service';
import { providerAccountCreateFingerprint } from './provider-connection-idempotency';

describe('provider connection mapping', () => {
  it('omits providerAccountId from the public DTO', () => {
    const response = toProviderConnectionResponse({
      id: '01934567-89ab-7cde-8f01-23456789abcd',
      organizationId: 'org-1',
      provider: 'stripe',
      providerAccountId: 'acct_should_not_leak',
      status: ProviderAccountConnectionStatus.REQUIRES_ACTION,
      paymentsEnabled: false,
      payoutsEnabled: false,
      requirementsDue: true,
      createdAt: new Date('2026-09-02T16:00:00.000Z'),
      updatedAt: new Date('2026-09-02T16:00:00.000Z'),
    });
    expect(response).toEqual({
      id: '01934567-89ab-7cde-8f01-23456789abcd',
      provider: 'stripe',
      status: 'REQUIRES_ACTION',
      paymentsEnabled: false,
      payoutsEnabled: false,
      requirementsDue: true,
      createdAt: new Date('2026-09-02T16:00:00.000Z'),
      updatedAt: new Date('2026-09-02T16:00:00.000Z'),
    });
    expect(JSON.stringify(response)).not.toContain('acct_');
    expect(JSON.stringify(response)).not.toContain('providerAccountId');
  });

  it('fingerprints Stripe connection creates by organization and provider only', () => {
    const first = providerAccountCreateFingerprint('org-1');
    const second = providerAccountCreateFingerprint('org-1');
    const other = providerAccountCreateFingerprint('org-2');
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps canonical statuses aligned with the Stripe observation vocabulary', () => {
    expect(ProviderAccountConnectionStatus.REQUIRES_ACTION).toBe(
      PROVIDER_ACCOUNT_STATUSES.REQUIRES_ACTION,
    );
    expect(ProviderAccountConnectionStatus.ACTIVE).toBe(PROVIDER_ACCOUNT_STATUSES.ACTIVE);
  });
});
