import { ProviderContractError } from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import { PROVIDER_ACCOUNT_STATUSES } from './connect-types.js';
import { normalizeStripeAccountObservation } from './account-readiness.js';

const NOW = new Date('2026-09-02T16:00:00.000Z');

describe('normalizeStripeAccountObservation', () => {
  it('maps pending capabilities with currently_due requirements to REQUIRES_ACTION', () => {
    const observation = normalizeStripeAccountObservation(
      {
        id: 'acct_pending',
        configuration: {
          merchant: {
            applied: true,
            capabilities: {
              card_payments: { status: 'pending' },
              stripe_balance: { payouts: { status: 'pending' } },
            },
          },
        },
        requirements: {
          summary: { minimum_deadline: { status: 'currently_due' } },
        },
      },
      NOW,
    );
    expect(observation.status).toBe(PROVIDER_ACCOUNT_STATUSES.REQUIRES_ACTION);
    expect(observation.paymentsEnabled).toBe(false);
    expect(observation.payoutsEnabled).toBe(false);
    expect(observation.requirementsDue).toBe(true);
    expect(observation.providerAccountReference).toEqual({
      provider: 'stripe',
      id: 'acct_pending',
    });
    expect(JSON.stringify(observation)).not.toContain('currently_due');
    expect(JSON.stringify(observation)).not.toContain('card_payments');
  });

  it('maps active card payments and payouts to ACTIVE even if eventually_due remains', () => {
    const observation = normalizeStripeAccountObservation(
      {
        id: 'acct_active',
        configuration: {
          merchant: {
            applied: true,
            capabilities: {
              card_payments: { status: 'active' },
              stripe_balance: { payouts: { status: 'active' } },
            },
          },
        },
        requirements: {
          summary: { minimum_deadline: { status: 'eventually_due' } },
        },
      },
      NOW,
    );
    expect(observation.status).toBe(PROVIDER_ACCOUNT_STATUSES.ACTIVE);
    expect(observation.paymentsEnabled).toBe(true);
    expect(observation.payoutsEnabled).toBe(true);
    expect(observation.requirementsDue).toBe(false);
  });

  it('maps restricted capabilities without currently_due requirements to RESTRICTED', () => {
    const observation = normalizeStripeAccountObservation(
      {
        id: 'acct_restricted',
        configuration: {
          merchant: {
            applied: true,
            capabilities: {
              card_payments: { status: 'restricted' },
              stripe_balance: { payouts: { status: 'restricted' } },
            },
          },
        },
      },
      NOW,
    );
    expect(observation.status).toBe(PROVIDER_ACCOUNT_STATUSES.RESTRICTED);
    expect(observation.requirementsDue).toBe(false);
  });

  it('maps closed accounts to DISCONNECTED and pending-without-due to PENDING', () => {
    expect(normalizeStripeAccountObservation({ id: 'acct_closed', closed: true }, NOW).status).toBe(
      PROVIDER_ACCOUNT_STATUSES.DISCONNECTED,
    );
    expect(
      normalizeStripeAccountObservation(
        {
          id: 'acct_pending',
          configuration: {
            merchant: {
              applied: true,
              capabilities: {
                card_payments: { status: 'pending' },
              },
            },
          },
        },
        NOW,
      ).status,
    ).toBe(PROVIDER_ACCOUNT_STATUSES.PENDING);
  });

  it('rejects unrecognized capability statuses instead of inventing a FUP status', () => {
    expect(() =>
      normalizeStripeAccountObservation(
        {
          id: 'acct_unknown',
          configuration: {
            merchant: {
              capabilities: { card_payments: { status: 'charges_enabled' } },
            },
          },
        },
        NOW,
      ),
    ).toThrow(ProviderContractError);
  });
});
