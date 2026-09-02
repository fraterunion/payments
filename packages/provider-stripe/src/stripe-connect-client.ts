import Stripe from 'stripe';
import type { StripeApiVersion } from './api-version.js';
import type {
  StripeAccountOnboardingLinkParams,
  StripeAccountLinkSnapshot,
} from './account-link.js';
import type { StripeMerchantAccountCreateParams } from './account-create.js';
import type { StripeConnectedAccountSnapshot } from './account-readiness.js';
import type { StripeRequestOptions } from './request-options.js';
import type { StripeLiveClientConfig } from './stripe-client.js';

export type StripeConnectAccountRetrieveParams = {
  readonly include: StripeMerchantAccountCreateParams['include'];
};

export type StripeConnectClientPort = {
  readonly accounts: {
    create(
      params: StripeMerchantAccountCreateParams,
      options?: StripeRequestOptions,
    ): Promise<StripeConnectedAccountSnapshot>;
    retrieve(
      id: string,
      params: StripeConnectAccountRetrieveParams,
      options?: StripeRequestOptions,
    ): Promise<StripeConnectedAccountSnapshot>;
  };
  readonly accountLinks: {
    create(
      params: StripeAccountOnboardingLinkParams,
      options?: StripeRequestOptions,
    ): Promise<StripeAccountLinkSnapshot>;
  };
};

function snapshotAccount(account: Stripe.V2.Core.Account): StripeConnectedAccountSnapshot {
  return {
    id: account.id,
    ...(account.closed !== undefined ? { closed: account.closed } : {}),
    ...(account.configuration !== undefined
      ? {
          configuration: {
            ...(account.configuration.merchant !== undefined
              ? {
                  merchant: {
                    applied: account.configuration.merchant.applied,
                    ...(account.configuration.merchant.capabilities !== undefined
                      ? {
                          capabilities: {
                            ...(account.configuration.merchant.capabilities.card_payments !==
                            undefined
                              ? {
                                  card_payments: {
                                    status:
                                      account.configuration.merchant.capabilities.card_payments
                                        .status,
                                  },
                                }
                              : {}),
                            ...(account.configuration.merchant.capabilities.stripe_balance !==
                            undefined
                              ? {
                                  stripe_balance: {
                                    ...(account.configuration.merchant.capabilities.stripe_balance
                                      .payouts !== undefined
                                      ? {
                                          payouts: {
                                            status:
                                              account.configuration.merchant.capabilities
                                                .stripe_balance.payouts.status,
                                          },
                                        }
                                      : {}),
                                  },
                                }
                              : {}),
                          },
                        }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(account.requirements !== undefined
      ? {
          requirements: {
            ...(account.requirements.entries !== undefined
              ? {
                  entries: account.requirements.entries.map((entry) => ({
                    ...(entry.minimum_deadline !== undefined
                      ? { minimum_deadline: { status: entry.minimum_deadline.status } }
                      : {}),
                  })),
                }
              : {}),
            ...(account.requirements.summary !== undefined
              ? {
                  summary: {
                    ...(account.requirements.summary.minimum_deadline !== undefined
                      ? {
                          minimum_deadline: {
                            status: account.requirements.summary.minimum_deadline.status,
                          },
                        }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

function snapshotAccountLink(link: Stripe.V2.Core.AccountLink): StripeAccountLinkSnapshot {
  return {
    url: link.url,
    ...(link.expires_at !== undefined ? { expires_at: link.expires_at } : {}),
  };
}

/**
 * Wraps Stripe Accounts v2 / Account Links v2. Not part of the public adapter API.
 */
export function createLiveStripeConnectClient(
  config: StripeLiveClientConfig,
): StripeConnectClientPort {
  const stripe = new Stripe(config.secretKey, {
    apiVersion: config.apiVersion,
    ...(config.appInfo !== undefined ? { appInfo: { ...config.appInfo } } : {}),
    maxNetworkRetries: 0,
    typescript: true,
  });

  return {
    accounts: {
      create: async (params, options) =>
        snapshotAccount(
          await stripe.v2.core.accounts.create(
            {
              ...params,
              include: [...params.include],
            },
            options,
          ),
        ),
      retrieve: async (id, params, options) =>
        snapshotAccount(
          await stripe.v2.core.accounts.retrieve(id, { include: [...params.include] }, options),
        ),
    },
    accountLinks: {
      create: async (params, options) =>
        snapshotAccountLink(
          await stripe.v2.core.accountLinks.create(
            {
              account: params.account,
              use_case: {
                type: 'account_onboarding',
                account_onboarding: {
                  configurations: ['merchant'],
                  return_url: params.use_case.account_onboarding.return_url,
                  refresh_url: params.use_case.account_onboarding.refresh_url,
                },
              },
            },
            options,
          ),
        ),
    },
  };
}

export type { StripeApiVersion };
