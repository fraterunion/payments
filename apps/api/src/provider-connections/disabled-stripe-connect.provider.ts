import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';
import type {
  ProviderAccountObservation,
  StripeConnectAccountCreateInput,
  StripeConnectAccountRetrieveInput,
  StripeConnectOnboardingLinkInput,
  StripeHostedOnboardingLink,
} from '@fraterunion-payments/provider-stripe';
import type { StripeConnectProviderPort } from './stripe-connect.tokens';

/**
 * Used when Stripe is intentionally disabled so unrelated API startup stays
 * green. Write endpoints map this to PROVIDER_CONFIGURATION_ERROR.
 */
export class DisabledStripeConnectProvider implements StripeConnectProviderPort {
  async createConnectedAccount(
    _input: StripeConnectAccountCreateInput,
  ): Promise<ProviderAccountObservation> {
    throw new ProviderConfigurationError('Stripe is not enabled.');
  }

  async retrieveConnectedAccount(
    _input: StripeConnectAccountRetrieveInput,
  ): Promise<ProviderAccountObservation> {
    throw new ProviderConfigurationError('Stripe is not enabled.');
  }

  async createHostedOnboardingLink(
    _input: StripeConnectOnboardingLinkInput,
  ): Promise<StripeHostedOnboardingLink> {
    throw new ProviderConfigurationError('Stripe is not enabled.');
  }
}
