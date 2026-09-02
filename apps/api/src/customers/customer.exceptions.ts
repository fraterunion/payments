import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES, type ErrorCode } from '../common/constants/error-codes.constants';

export class CustomerException extends AppException {
  constructor(code: ErrorCode, message: string, status: HttpStatus) {
    super(code, message, status);
  }
}

export class CustomerNotFoundException extends CustomerException {
  constructor() {
    super(ERROR_CODES.NOT_FOUND, 'Customer was not found.', HttpStatus.NOT_FOUND);
  }
}

export class CustomerArchivedException extends CustomerException {
  constructor() {
    super(ERROR_CODES.CUSTOMER_ARCHIVED, 'Archived customers are read-only.', HttpStatus.CONFLICT);
  }
}

export class CustomerValidationException extends CustomerException {
  constructor(message: string) {
    super(ERROR_CODES.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST);
  }
}

export function mapCustomerUniqueViolation(error: unknown): CustomerException | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return undefined;
  }

  const target = uniqueTarget(error);
  if (
    target.includes('customers_org_external_ref') ||
    target.includes('external_reference') ||
    target.includes('externalreference')
  ) {
    return new CustomerException(
      ERROR_CODES.CUSTOMER_EXTERNAL_REFERENCE_EXISTS,
      'A customer with this external reference already exists in the organization.',
      HttpStatus.CONFLICT,
    );
  }
  if (
    target.includes('provider_identity') ||
    target.includes('provider_customer_id') ||
    target.includes('providercustomerid')
  ) {
    return new CustomerException(
      ERROR_CODES.PROVIDER_CUSTOMER_ALREADY_MAPPED,
      'This provider customer is already mapped in the organization.',
      HttpStatus.CONFLICT,
    );
  }
  if (
    target.includes('customer_provider_scope') ||
    target.includes('provider_account_scope') ||
    target.includes('provideraccountscope')
  ) {
    return new CustomerException(
      ERROR_CODES.CUSTOMER_PROVIDER_MAPPING_EXISTS,
      'This customer already has a mapping for the provider account scope.',
      HttpStatus.CONFLICT,
    );
  }
  return new CustomerException(
    ERROR_CODES.CONFLICT,
    'The resource already exists.',
    HttpStatus.CONFLICT,
  );
}

function uniqueTarget(error: Prisma.PrismaClientKnownRequestError): string {
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
  if (error.meta !== undefined) {
    parts.push(JSON.stringify(error.meta));
  }
  parts.push(error.message);
  return parts.join(' ').toLowerCase();
}
