import type { Prisma, PrismaClient } from '@fraterunion-payments/database';

/** Prisma client or an open interactive transaction. */
export type EventWriteClient = PrismaClient | Prisma.TransactionClient;

export const PLATFORM_SCOPE_KEY = 'platform';

export const DEFAULT_MAX_ATTEMPTS = 10;
export const DEFAULT_RETRY_BASE_MS = 1_000;
export const DEFAULT_RETRY_MAX_MS = 900_000;
export const DEFAULT_CLAIM_LEASE_MS = 60_000;

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  baseDelayMs: DEFAULT_RETRY_BASE_MS,
  maxDelayMs: DEFAULT_RETRY_MAX_MS,
};

export type InboxReceiveKind = 'NEW' | 'DUPLICATE' | 'CONFLICT';

/**
 * Sources whose `externalEventId` is unique regardless of `scopeKey`.
 * Stripe Event IDs (`evt_…`) are provider identity; tenant scope is routing.
 */
export const GLOBALLY_UNIQUE_INBOX_SOURCES: ReadonlySet<string> = new Set(['stripe']);

export function isGloballyUniqueInboxSource(source: string): boolean {
  return GLOBALLY_UNIQUE_INBOX_SOURCES.has(source);
}
