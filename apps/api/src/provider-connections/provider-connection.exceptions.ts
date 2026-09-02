import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import {
  isProviderContractError,
  ProviderAuthenticationError,
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from '@fraterunion-payments/provider-contracts';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES, type ErrorCode } from '../common/constants/error-codes.constants';
import { isIdempotencyUnique } from '../idempotency/idempotency.exceptions';

export {
  IdempotencyKeyConflictException,
  IdempotencyKeyInvalidException,
  IdempotencyKeyRequiredException,
} from '../idempotency/idempotency.exceptions';

export class ProviderConnectionException extends AppException {
  constructor(code: ErrorCode, message: string, status: HttpStatus) {
    super(code, message, status);
  }
}

export class ProviderConnectionNotFoundException extends ProviderConnectionException {
  constructor() {
    super(
      ERROR_CODES.PROVIDER_CONNECTION_NOT_FOUND,
      'Provider connection was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ProviderConnectionAlreadyExistsException extends ProviderConnectionException {
  constructor() {
    super(
      ERROR_CODES.PROVIDER_CONNECTION_ALREADY_EXISTS,
      'A provider connection for this organization already exists.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ProviderConnectionCreateInProgressException extends ProviderConnectionException {
  constructor() {
    super(
      ERROR_CODES.PROVIDER_CONNECTION_CREATE_IN_PROGRESS,
      'Provider account provisioning is already in progress for this organization.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ProviderConnectionNotReadyException extends ProviderConnectionException {
  constructor() {
    super(
      ERROR_CODES.PROVIDER_CONNECTION_NOT_READY,
      'The provider connection is not ready for this operation.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ProviderOnboardingLinkFailedException extends ProviderConnectionException {
  constructor() {
    super(
      ERROR_CODES.PROVIDER_ONBOARDING_LINK_FAILED,
      'The hosted onboarding link could not be created.',
      HttpStatus.BAD_GATEWAY,
    );
  }
}

export class ProviderConfigurationException extends ProviderConnectionException {
  constructor(message = 'Payment provider configuration is invalid or unavailable.') {
    super(ERROR_CODES.PROVIDER_CONFIGURATION_ERROR, message, HttpStatus.BAD_REQUEST);
  }
}

export class ProviderDependencyUnavailableException extends ProviderConnectionException {
  constructor() {
    super(
      ERROR_CODES.DEPENDENCY_UNAVAILABLE,
      'The payment provider is temporarily unavailable.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export function mapProviderConnectionPrismaError(
  error: unknown,
): ProviderConnectionException | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }
  if (error.code === 'P2002') {
    if (isIdempotencyUnique(error)) {
      return undefined;
    }
    const target = constraintTarget(error);
    if (target.includes('organization_id') && target.includes('provider')) {
      return new ProviderConnectionAlreadyExistsException();
    }
    if (target.includes('provider_account_id') || target.includes('provideraccountid')) {
      return new ProviderConnectionAlreadyExistsException();
    }
    return new ProviderConnectionAlreadyExistsException();
  }
  return undefined;
}

export function mapConnectProviderError(error: unknown): ProviderConnectionException | undefined {
  if (error instanceof ProviderTimeoutError || error instanceof ProviderUnavailableError) {
    return new ProviderDependencyUnavailableException();
  }
  if (error instanceof ProviderRateLimitError) {
    return new ProviderDependencyUnavailableException();
  }
  if (error instanceof ProviderAuthenticationError || error instanceof ProviderConfigurationError) {
    return new ProviderConfigurationException();
  }
  if (isProviderContractError(error)) {
    return new ProviderConfigurationException();
  }
  return undefined;
}

function constraintTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const parts: string[] = [];
  const target = error.meta?.['target'];
  if (Array.isArray(target)) {
    parts.push(...target.map(String));
  } else if (typeof target === 'string') {
    parts.push(target);
  }
  const constraint = error.meta?.['constraint'];
  if (typeof constraint === 'string') {
    parts.push(constraint);
  }
  parts.push(error.message);
  return parts.join(' ').toLowerCase();
}
