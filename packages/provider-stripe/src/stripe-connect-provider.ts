import {
  assertProviderOwns,
  ProviderConfigurationError,
} from '@fraterunion-payments/provider-contracts';
import { STRIPE_API_VERSION, type StripeApiVersion } from './api-version.js';
import { buildStripeAccountCreateParams, STRIPE_ACCOUNT_INCLUDE } from './account-create.js';
import { asStripeAccountId } from './account-id.js';
import { buildStripeAccountOnboardingLinkParams } from './account-link.js';
import { normalizeStripeAccountObservation } from './account-readiness.js';
import { assertStripeAccountLinkUrl } from './connect-urls.js';
import type {
  ProviderAccountObservation,
  StripeConnectAccountCreateInput,
  StripeConnectAccountRetrieveInput,
  StripeConnectOnboardingLinkInput,
  StripeConnectOperations,
  StripeHostedOnboardingLink,
} from './connect-types.js';
import { STRIPE_PROVIDER_CODE } from './constants.js';
import { isStripeConnectPlatformBlocked, normalizeStripeError } from './errors.js';
import { createStripeRequestOptions } from './request-options.js';
import { assertStripeSecretKeyMode } from './secret-key.js';
import {
  createLiveStripeConnectClient,
  type StripeConnectClientPort,
} from './stripe-connect-client.js';

export type StripeConnectProviderConfig = {
  readonly secretKey: string;
  readonly apiVersion?: StripeApiVersion;
  readonly allowLive?: boolean;
  readonly urlEnvironment?: 'production' | 'development' | 'test';
  readonly appInfo?: {
    readonly name: string;
    readonly version?: string;
    readonly url?: string;
    readonly partner_id?: string;
  };
};

type StripeConnectProviderInternals = {
  readonly client?: StripeConnectClientPort;
  readonly now?: () => Date;
};

function requireApiVersion(apiVersion: string | undefined): StripeApiVersion {
  if (apiVersion === undefined) {
    return STRIPE_API_VERSION;
  }
  if (apiVersion !== STRIPE_API_VERSION) {
    throw new ProviderConfigurationError('Unsupported Stripe API version.');
  }
  return apiVersion;
}

/**
 * Stripe Connect Accounts v2 + hosted Account Links. Separate from
 * `StripePaymentProvider` — onboarding is not payment execution.
 */
export class StripeConnectProvider implements StripeConnectOperations {
  readonly code = STRIPE_PROVIDER_CODE;
  readonly apiVersion: StripeApiVersion;

  readonly #client: StripeConnectClientPort;
  readonly #now: () => Date;
  readonly #urlEnvironment: 'production' | 'development' | 'test';

  constructor(config: StripeConnectProviderConfig, internals: StripeConnectProviderInternals = {}) {
    assertStripeSecretKeyMode(config.secretKey, { allowLive: config.allowLive === true });
    this.apiVersion = requireApiVersion(config.apiVersion);
    this.#urlEnvironment = config.urlEnvironment ?? 'test';
    this.#client =
      internals.client ??
      createLiveStripeConnectClient({
        secretKey: config.secretKey,
        apiVersion: this.apiVersion,
        ...(config.appInfo !== undefined ? { appInfo: config.appInfo } : {}),
      });
    this.#now = internals.now ?? (() => new Date());
  }

  async createConnectedAccount(
    input: StripeConnectAccountCreateInput,
  ): Promise<ProviderAccountObservation> {
    const params = buildStripeAccountCreateParams({
      displayName: input.displayName,
      country: input.country,
      defaultCurrency: input.defaultCurrency,
    });
    const options = createStripeRequestOptions({
      provider: this.code,
      idempotencyKey: input.idempotencyKey,
    });
    try {
      const account = await this.#client.accounts.create(params, options);
      return normalizeStripeAccountObservation(account, this.#now());
    } catch (error) {
      if (isStripeConnectPlatformBlocked(error)) {
        throw new ProviderConfigurationError('Stripe Connect is not enabled for this platform.');
      }
      normalizeStripeError(error);
    }
  }

  async retrieveConnectedAccount(
    input: StripeConnectAccountRetrieveInput,
  ): Promise<ProviderAccountObservation> {
    assertProviderOwns(this.code, input.providerAccountReference);
    const id = asStripeAccountId(input.providerAccountReference.id);
    try {
      const account = await this.#client.accounts.retrieve(
        id,
        { include: [...STRIPE_ACCOUNT_INCLUDE] },
        createStripeRequestOptions({ provider: this.code }),
      );
      return normalizeStripeAccountObservation(account, this.#now());
    } catch (error) {
      normalizeStripeError(error);
    }
  }

  async createHostedOnboardingLink(
    input: StripeConnectOnboardingLinkInput,
  ): Promise<StripeHostedOnboardingLink> {
    assertProviderOwns(this.code, input.providerAccountReference);
    const params = buildStripeAccountOnboardingLinkParams({
      providerAccountId: input.providerAccountReference.id,
      returnUrl: input.returnUrl,
      refreshUrl: input.refreshUrl,
      environment: this.#urlEnvironment,
    });
    try {
      const link = await this.#client.accountLinks.create(
        params,
        createStripeRequestOptions({ provider: this.code }),
      );
      const url = assertStripeAccountLinkUrl(link.url);
      if (link.expires_at === undefined) {
        return { url };
      }
      const expiresAt = new Date(link.expires_at);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new ProviderConfigurationError('Stripe onboarding link expiry is invalid.');
      }
      return { url, expiresAt };
    } catch (error) {
      normalizeStripeError(error);
    }
  }
}
