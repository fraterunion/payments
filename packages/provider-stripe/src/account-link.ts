import { asStripeAccountId } from './account-id.js';
import {
  assertStripeHostedOnboardingUrls,
  type StripeConnectUrlEnvironment,
} from './connect-urls.js';

export type StripeAccountOnboardingLinkParams = {
  readonly account: string;
  readonly use_case: {
    readonly type: 'account_onboarding';
    readonly account_onboarding: {
      readonly configurations: readonly ['merchant'];
      readonly return_url: string;
      readonly refresh_url: string;
    };
  };
};

/**
 * Accounts v2 hosted onboarding. Account Sessions are for embedded
 * Connect components and are not used here.
 */
export function buildStripeAccountOnboardingLinkParams(input: {
  readonly providerAccountId: string;
  readonly returnUrl: string;
  readonly refreshUrl: string;
  readonly environment: StripeConnectUrlEnvironment;
}): StripeAccountOnboardingLinkParams {
  const urls = assertStripeHostedOnboardingUrls({
    returnUrl: input.returnUrl,
    refreshUrl: input.refreshUrl,
    environment: input.environment,
  });
  return {
    account: asStripeAccountId(input.providerAccountId),
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant'],
        return_url: urls.returnUrl,
        refresh_url: urls.refreshUrl,
      },
    },
  };
}

export type StripeAccountLinkSnapshot = {
  readonly url: string;
  readonly expires_at?: string;
};
