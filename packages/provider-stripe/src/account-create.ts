import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';

export const STRIPE_ACCOUNT_INCLUDE = [
  'configuration.merchant',
  'requirements',
  'defaults',
] as const;

export const STRIPE_DISPLAY_NAME_MAX_LENGTH = 150;

const ISO_COUNTRY = /^[A-Za-z]{2}$/;
const ISO_CURRENCY = /^[A-Za-z]{3}$/;

function requireDisplayName(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProviderConfigurationError('Display name is required.');
  }
  const trimmed = value.trim();
  if (trimmed.length > STRIPE_DISPLAY_NAME_MAX_LENGTH) {
    throw new ProviderConfigurationError('Display name exceeds the maximum length.');
  }
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      throw new ProviderConfigurationError('Display name must not contain control characters.');
    }
  }
  return trimmed;
}

export type StripeMerchantAccountCreateParams = {
  readonly display_name: string;
  readonly dashboard: 'full';
  readonly identity: {
    readonly country: string;
    readonly entity_type: 'company';
  };
  readonly configuration: {
    readonly merchant: {
      readonly capabilities: {
        readonly card_payments: {
          readonly requested: true;
        };
      };
    };
  };
  readonly defaults: {
    readonly currency: string;
    readonly responsibilities: {
      readonly fees_collector: 'stripe';
      readonly losses_collector: 'stripe';
    };
  };
  readonly include: readonly (typeof STRIPE_ACCOUNT_INCLUDE)[number][];
};

/**
 * Accounts v2 create payload for a SaaS merchant that will accept its
 * own customers (direct charges later). Merchant configuration only —
 * no customer or recipient configuration. `dashboard: full` is the
 * combination that Stripe documents as compatible with
 * `fees_collector`/`losses_collector` = `stripe`. Express dashboard
 * would force application fee/loss liability.
 */
export function buildStripeAccountCreateParams(input: {
  readonly displayName: string;
  readonly country: string;
  readonly defaultCurrency: string;
}): StripeMerchantAccountCreateParams {
  const displayName = requireDisplayName(input.displayName);
  const country = input.country.trim();
  if (!ISO_COUNTRY.test(country)) {
    throw new ProviderConfigurationError('Connected-account country must be ISO 3166-1 alpha-2.');
  }
  const currency = input.defaultCurrency.trim();
  if (!ISO_CURRENCY.test(currency)) {
    throw new ProviderConfigurationError('Connected-account currency must be ISO 4217.');
  }

  return {
    display_name: displayName,
    dashboard: 'full',
    identity: {
      country: country.toLowerCase(),
      entity_type: 'company',
    },
    configuration: {
      merchant: {
        capabilities: {
          card_payments: { requested: true },
        },
      },
    },
    defaults: {
      currency: currency.toLowerCase(),
      responsibilities: {
        fees_collector: 'stripe',
        losses_collector: 'stripe',
      },
    },
    include: [...STRIPE_ACCOUNT_INCLUDE],
  };
}
