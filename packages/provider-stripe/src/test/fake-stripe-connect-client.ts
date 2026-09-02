import Stripe from 'stripe';
import type {
  StripeAccountOnboardingLinkParams,
  StripeAccountLinkSnapshot,
} from '../account-link.js';
import type { StripeMerchantAccountCreateParams } from '../account-create.js';
import type { StripeConnectedAccountSnapshot } from '../account-readiness.js';
import type { StripeRequestOptions } from '../request-options.js';
import type {
  StripeConnectAccountRetrieveParams,
  StripeConnectClientPort,
} from '../stripe-connect-client.js';

type StoredAccount = StripeConnectedAccountSnapshot;

export class FakeStripeConnectClient implements StripeConnectClientPort {
  readonly lastCreateParams: StripeMerchantAccountCreateParams[] = [];
  readonly lastCreateOptions: Array<StripeRequestOptions | undefined> = [];
  readonly lastRetrieveIds: string[] = [];
  readonly lastAccountLinkParams: StripeAccountOnboardingLinkParams[] = [];
  readonly lastAccountLinkOptions: Array<StripeRequestOptions | undefined> = [];

  private readonly accountsById = new Map<string, StoredAccount>();
  private readonly idempotent = new Map<string, StoredAccount>();
  private sequence = 0;
  private forcedError: unknown;
  private linkSequence = 0;

  failNext(error: unknown): void {
    this.forcedError = error;
  }

  setAccount(account: StoredAccount): void {
    this.accountsById.set(account.id, account);
  }

  readonly accounts = {
    create: async (
      params: StripeMerchantAccountCreateParams,
      options?: StripeRequestOptions,
    ): Promise<StripeConnectedAccountSnapshot> => {
      this.throwForced();
      this.lastCreateParams.push(params);
      this.lastCreateOptions.push(options);
      if (options?.idempotencyKey !== undefined) {
        const cached = this.idempotent.get(options.idempotencyKey);
        if (cached !== undefined) {
          return cached;
        }
      }
      const created: StoredAccount = {
        id: `acct_${this.nextId()}`,
        closed: false,
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
          entries: [{ minimum_deadline: { status: 'currently_due' } }],
        },
      };
      this.accountsById.set(created.id, created);
      if (options?.idempotencyKey !== undefined) {
        this.idempotent.set(options.idempotencyKey, created);
      }
      return created;
    },
    retrieve: async (
      id: string,
      _params: StripeConnectAccountRetrieveParams,
      _options?: StripeRequestOptions,
    ): Promise<StripeConnectedAccountSnapshot> => {
      this.throwForced();
      this.lastRetrieveIds.push(id);
      const account = this.accountsById.get(id);
      if (account === undefined) {
        throw new Stripe.errors.StripeInvalidRequestError({
          message: 'No such account',
          type: 'invalid_request_error',
          statusCode: 404,
        });
      }
      return account;
    },
  };

  readonly accountLinks = {
    create: async (
      params: StripeAccountOnboardingLinkParams,
      options?: StripeRequestOptions,
    ): Promise<StripeAccountLinkSnapshot> => {
      this.throwForced();
      this.lastAccountLinkParams.push(params);
      this.lastAccountLinkOptions.push(options);
      if (this.accountsById.get(params.account) === undefined) {
        throw new Stripe.errors.StripeInvalidRequestError({
          message: 'No such account',
          type: 'invalid_request_error',
          statusCode: 404,
        });
      }
      this.linkSequence += 1;
      return {
        url: `https://connect.stripe.com/setup/e/acct_fake/${this.linkSequence}`,
        expires_at: '2026-09-02T18:00:00.000Z',
      };
    },
  };

  private throwForced(): void {
    if (this.forcedError !== undefined) {
      const error = this.forcedError;
      this.forcedError = undefined;
      throw error;
    }
  }

  private nextId(): string {
    this.sequence += 1;
    return `test${this.sequence}`;
  }
}

export function createFakeStripeConnectClient(): FakeStripeConnectClient {
  return new FakeStripeConnectClient();
}
