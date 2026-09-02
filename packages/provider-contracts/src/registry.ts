import {
  DuplicateProviderRegistrationError,
  ProviderContractError,
  PROVIDER_ERROR_CODES,
  ProviderRegistryFrozenError,
  UnknownProviderError,
} from './errors.js';
import { asPaymentProviderCode } from './provider-code.js';
import type { PaymentProviderCode } from './provider-code.js';
import type { PaymentProvider } from './provider.js';

/**
 * Explicit, process-constructed registry. Not a global singleton.
 * Register adapters at startup, then freeze before handling traffic.
 */
export class PaymentProviderRegistry {
  private readonly providers = new Map<PaymentProviderCode, PaymentProvider>();
  #frozen = false;

  get frozen(): boolean {
    return this.#frozen;
  }

  register(provider: PaymentProvider): void {
    if (this.#frozen) {
      throw new ProviderRegistryFrozenError();
    }
    const code = asPaymentProviderCode(provider.code);
    if (code !== provider.code) {
      throw new ProviderContractError(
        'PaymentProvider.code must already be a canonical PaymentProviderCode.',
        { code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_CODE },
      );
    }
    if (this.providers.has(code)) {
      throw new DuplicateProviderRegistrationError(code);
    }
    this.providers.set(code, provider);
  }

  freeze(): void {
    this.#frozen = true;
  }

  get(code: string): PaymentProvider {
    const canonical = asPaymentProviderCode(code);
    const provider = this.providers.get(canonical);
    if (provider === undefined) {
      throw new UnknownProviderError(canonical);
    }
    return provider;
  }

  has(code: string): boolean {
    return this.providers.has(asPaymentProviderCode(code));
  }

  listCodes(): readonly PaymentProviderCode[] {
    return [...this.providers.keys()];
  }
}
