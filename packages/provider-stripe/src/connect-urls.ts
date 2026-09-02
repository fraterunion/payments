import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';

export const STRIPE_CONNECT_URL_MAX_LENGTH = 2048;

export type StripeConnectUrlEnvironment = 'production' | 'development' | 'test';

function assertHttpUrl(value: string, label: string): URL {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProviderConfigurationError(`${label} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > STRIPE_CONNECT_URL_MAX_LENGTH) {
    throw new ProviderConfigurationError(`${label} exceeds the maximum length.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ProviderConfigurationError(`${label} must be an absolute URL.`);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ProviderConfigurationError(`${label} must not include credentials.`);
  }
  return parsed;
}

/**
 * Return/refresh URLs are application-configured, never request-supplied.
 * Production requires HTTPS. Local/test may use http://localhost.
 */
export function assertStripeConnectRedirectUrl(
  value: string,
  label: string,
  environment: StripeConnectUrlEnvironment,
): string {
  const parsed = assertHttpUrl(value, label);
  if (environment === 'production') {
    if (parsed.protocol !== 'https:') {
      throw new ProviderConfigurationError(`${label} must use HTTPS in production.`);
    }
    return parsed.toString();
  }
  const localhost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]';
  if (parsed.protocol === 'https:') {
    return parsed.toString();
  }
  if (parsed.protocol === 'http:' && localhost) {
    return parsed.toString();
  }
  throw new ProviderConfigurationError(
    `${label} must use HTTPS, or HTTP on localhost outside production.`,
  );
}

export function assertStripeHostedOnboardingUrls(input: {
  readonly returnUrl: string;
  readonly refreshUrl: string;
  readonly environment: StripeConnectUrlEnvironment;
}): { readonly returnUrl: string; readonly refreshUrl: string } {
  return {
    returnUrl: assertStripeConnectRedirectUrl(input.returnUrl, 'return URL', input.environment),
    refreshUrl: assertStripeConnectRedirectUrl(input.refreshUrl, 'refresh URL', input.environment),
  };
}

/**
 * The Account Link URL is an execution credential. Validate scheme only;
 * do not persist, log, or audit it.
 */
export function assertStripeAccountLinkUrl(value: string): string {
  const parsed = assertHttpUrl(value, 'onboarding URL');
  if (parsed.protocol !== 'https:') {
    throw new ProviderConfigurationError('Onboarding URL must use HTTPS.');
  }
  return parsed.toString();
}
