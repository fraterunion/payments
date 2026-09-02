import type { ProviderAccountConnectionStatus } from '@fraterunion-payments/database';

export const PROVIDER_CONNECTION_READ_ROLES = [
  'OWNER',
  'ADMIN',
  'DEVELOPER',
  'ANALYST',
  'SUPPORT',
] as const;

export const PROVIDER_CONNECTION_WRITE_ROLES = ['OWNER', 'ADMIN'] as const;

export const STRIPE_PROVIDER = 'stripe' as const;

export type ProviderConnectionResponse = {
  readonly id: string;
  readonly provider: string;
  readonly status: ProviderAccountConnectionStatus;
  readonly paymentsEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly requirementsDue: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type CreateStripeProviderConnectionInput = {
  readonly organizationId: string;
  readonly idempotencyKey: string;
};
