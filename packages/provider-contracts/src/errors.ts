export const PROVIDER_ERROR_CODES = {
  PROVIDER_CONTRACT: 'PROVIDER_CONTRACT',
  PROVIDER_CONFIGURATION: 'PROVIDER_CONFIGURATION',
  PROVIDER_AUTHENTICATION: 'PROVIDER_AUTHENTICATION',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_RATE_LIMIT: 'PROVIDER_RATE_LIMIT',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  UNSUPPORTED_PROVIDER_CAPABILITY: 'UNSUPPORTED_PROVIDER_CAPABILITY',
  UNKNOWN_PROVIDER: 'UNKNOWN_PROVIDER',
  DUPLICATE_PROVIDER_REGISTRATION: 'DUPLICATE_PROVIDER_REGISTRATION',
  PROVIDER_REGISTRY_FROZEN: 'PROVIDER_REGISTRY_FROZEN',
  PROVIDER_MISMATCH: 'PROVIDER_MISMATCH',
  INVALID_PROVIDER_CODE: 'INVALID_PROVIDER_CODE',
  INVALID_PROVIDER_REFERENCE: 'INVALID_PROVIDER_REFERENCE',
  INVALID_IDEMPOTENCY_KEY: 'INVALID_IDEMPOTENCY_KEY',
  INVALID_PROVIDER_METADATA: 'INVALID_PROVIDER_METADATA',
} as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[keyof typeof PROVIDER_ERROR_CODES];

export type ProviderContractErrorOptions = {
  readonly code?: ProviderErrorCode;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
};

/**
 * Adapter/transport execution problem. Distinct from a normalized
 * `PaymentFailure` (for example a card decline). No HTTP status lives here.
 */
export class ProviderContractError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(message: string, options: ProviderContractErrorOptions = {}) {
    super(message);
    this.name = 'ProviderContractError';
    this.code = options.code ?? PROVIDER_ERROR_CODES.PROVIDER_CONTRACT;
    this.retryable = options.retryable ?? false;
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }
}

export class ProviderConfigurationError extends ProviderContractError {
  constructor(message: string) {
    super(message, {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONFIGURATION,
      retryable: false,
    });
    this.name = 'ProviderConfigurationError';
  }
}

export class ProviderAuthenticationError extends ProviderContractError {
  constructor(message: string) {
    super(message, {
      code: PROVIDER_ERROR_CODES.PROVIDER_AUTHENTICATION,
      retryable: false,
    });
    this.name = 'ProviderAuthenticationError';
  }
}

export class ProviderUnavailableError extends ProviderContractError {
  constructor(message: string) {
    super(message, {
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      retryable: true,
    });
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderRateLimitError extends ProviderContractError {
  constructor(message: string, retryAfterMs?: number) {
    super(message, {
      code: PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMIT,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
    this.name = 'ProviderRateLimitError';
  }
}

export class ProviderTimeoutError extends ProviderContractError {
  constructor(message: string) {
    super(message, {
      code: PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT,
      retryable: true,
    });
    this.name = 'ProviderTimeoutError';
  }
}

export class UnsupportedProviderCapabilityError extends ProviderContractError {
  readonly capability: string;

  constructor(capability: string, message?: string) {
    super(message ?? `Provider does not advertise capability "${capability}".`, {
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_PROVIDER_CAPABILITY,
      retryable: false,
    });
    this.name = 'UnsupportedProviderCapabilityError';
    this.capability = capability;
  }
}

export class UnknownProviderError extends ProviderContractError {
  constructor(code: string) {
    super(`No payment provider is registered for code "${code}".`, {
      code: PROVIDER_ERROR_CODES.UNKNOWN_PROVIDER,
      retryable: false,
    });
    this.name = 'UnknownProviderError';
  }
}

export class DuplicateProviderRegistrationError extends ProviderContractError {
  constructor(code: string) {
    super(`Payment provider "${code}" is already registered.`, {
      code: PROVIDER_ERROR_CODES.DUPLICATE_PROVIDER_REGISTRATION,
      retryable: false,
    });
    this.name = 'DuplicateProviderRegistrationError';
  }
}

export class ProviderRegistryFrozenError extends ProviderContractError {
  constructor() {
    super('Payment provider registry is frozen and cannot accept registrations.', {
      code: PROVIDER_ERROR_CODES.PROVIDER_REGISTRY_FROZEN,
      retryable: false,
    });
    this.name = 'ProviderRegistryFrozenError';
  }
}

export class ProviderMismatchError extends ProviderContractError {
  constructor(expected: string, actual: string) {
    super(`Provider mismatch: expected "${expected}", received "${actual}".`, {
      code: PROVIDER_ERROR_CODES.PROVIDER_MISMATCH,
      retryable: false,
    });
    this.name = 'ProviderMismatchError';
  }
}

export function isProviderContractError(error: unknown): error is ProviderContractError {
  return error instanceof ProviderContractError;
}
