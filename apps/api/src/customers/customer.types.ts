import type { CustomerStatus, CustomerType } from '@fraterunion-payments/database';

export const CUSTOMER_LIST_DEFAULT_LIMIT = 50;
export const CUSTOMER_LIST_MAX_LIMIT = 100;
export const CUSTOMER_METADATA_MAX_BYTES = 16_384;
export const CUSTOMER_METADATA_MAX_DEPTH = 8;
export const DEFAULT_PROVIDER_ACCOUNT_SCOPE = 'default';
export const PROVIDER_ACCOUNT_SCOPE_PREFIX = 'acct:';

export const CUSTOMER_READ_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'ANALYST', 'SUPPORT'] as const;
export const CUSTOMER_WRITE_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER'] as const;

export type CreateCustomerInput = {
  readonly organizationId: string;
  readonly type?: CustomerType;
  readonly email?: string;
  readonly name?: string;
  readonly phone?: string;
  readonly externalReference?: string;
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
};

export type UpdateCustomerInput = {
  readonly type?: CustomerType;
  readonly email?: string | null;
  readonly name?: string | null;
  readonly phone?: string | null;
  readonly externalReference?: string | null;
  readonly description?: string | null;
  readonly metadata?: Record<string, unknown>;
};

export type CustomerListCursor = {
  readonly createdAt: Date;
  readonly id: string;
};

export type ListCustomersQuery = {
  readonly organizationId: string;
  readonly status?: CustomerStatus;
  readonly q?: string;
  readonly limit?: number;
  readonly cursor?: CustomerListCursor;
};

export type CreateProviderMappingInput = {
  readonly organizationId: string;
  readonly customerId: string;
  readonly provider: string;
  readonly providerCustomerId: string;
  readonly providerAccountReference?: string;
};
