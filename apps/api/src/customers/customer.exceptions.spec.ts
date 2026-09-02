import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import { ERROR_CODES } from '../common/constants/error-codes.constants';
import { mapCustomerUniqueViolation } from './customer.exceptions';

function uniqueError(meta: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta,
  });
}

describe('mapCustomerUniqueViolation', () => {
  it('maps the external-reference index name Prisma reports as P2002 target', () => {
    const mapped = mapCustomerUniqueViolation(
      uniqueError({ target: 'customers_org_external_ref_uidx' }),
    );
    expect(mapped?.code).toBe(ERROR_CODES.CUSTOMER_EXTERNAL_REFERENCE_EXISTS);
    expect(mapped?.getStatus()).toBe(HttpStatus.CONFLICT);
  });

  it('maps provider-identity uniqueness without leaking the constraint name', () => {
    const mapped = mapCustomerUniqueViolation(
      uniqueError({ constraint: 'customer_provider_mappings_provider_identity_uidx' }),
    );
    expect(mapped?.code).toBe(ERROR_CODES.PROVIDER_CUSTOMER_ALREADY_MAPPED);
    expect(mapped?.message).not.toMatch(/uidx|prisma|P2002/i);
  });

  it('maps customer/provider-scope uniqueness', () => {
    const mapped = mapCustomerUniqueViolation(
      uniqueError({ target: ['customerId', 'provider', 'providerAccountScope'] }),
    );
    expect(mapped?.code).toBe(ERROR_CODES.CUSTOMER_PROVIDER_MAPPING_EXISTS);
  });

  it('ignores non-unique Prisma errors', () => {
    expect(mapCustomerUniqueViolation(new Error('nope'))).toBeUndefined();
  });
});
