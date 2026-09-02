import {
  createProviderAccountReference,
  ProviderConfigurationError,
} from '@fraterunion-payments/provider-contracts';
import {
  PROVIDER_ACCOUNT_STATUSES,
  type ProviderAccountObservation,
  type StripeConnectAccountCreateInput,
  type StripeConnectAccountRetrieveInput,
  type StripeConnectOnboardingLinkInput,
  type StripeConnectOperations,
  type StripeHostedOnboardingLink,
} from '@fraterunion-payments/provider-stripe';

export class FakeStripeConnectProvider implements StripeConnectOperations {
  readonly createdIdempotencyKeys: string[] = [];
  readonly retrievedIds: string[] = [];
  readonly onboardingLinkAccountIds: string[] = [];
  failNext: unknown;
  private sequence = 0;
  private readonly byKey = new Map<string, ProviderAccountObservation>();
  private readonly byAccountId = new Map<string, ProviderAccountObservation>();

  setObservation(observation: ProviderAccountObservation): void {
    this.byAccountId.set(observation.providerAccountReference.id, observation);
  }

  async createConnectedAccount(
    input: StripeConnectAccountCreateInput,
  ): Promise<ProviderAccountObservation> {
    this.throwForced();
    this.createdIdempotencyKeys.push(input.idempotencyKey);
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing !== undefined) {
      return existing;
    }
    this.sequence += 1;
    const observation: ProviderAccountObservation = {
      providerAccountReference: createProviderAccountReference({
        provider: 'stripe',
        id: `acct_fake${this.sequence}`,
      }),
      status: PROVIDER_ACCOUNT_STATUSES.REQUIRES_ACTION,
      paymentsEnabled: false,
      payoutsEnabled: false,
      requirementsDue: true,
      observedAt: new Date('2026-09-02T16:00:00.000Z'),
    };
    this.byKey.set(input.idempotencyKey, observation);
    this.byAccountId.set(observation.providerAccountReference.id, observation);
    return observation;
  }

  async retrieveConnectedAccount(
    input: StripeConnectAccountRetrieveInput,
  ): Promise<ProviderAccountObservation> {
    this.throwForced();
    this.retrievedIds.push(input.providerAccountReference.id);
    const existing = this.byAccountId.get(input.providerAccountReference.id);
    if (existing === undefined) {
      throw new ProviderConfigurationError('Unknown connected account.');
    }
    return existing;
  }

  async createHostedOnboardingLink(
    input: StripeConnectOnboardingLinkInput,
  ): Promise<StripeHostedOnboardingLink> {
    this.throwForced();
    this.onboardingLinkAccountIds.push(input.providerAccountReference.id);
    this.sequence += 1;
    return {
      url: `https://connect.stripe.com/setup/e/fake/${this.sequence}`,
      expiresAt: new Date('2026-09-02T18:00:00.000Z'),
    };
  }

  private throwForced(): void {
    if (this.failNext !== undefined) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
  }
}
