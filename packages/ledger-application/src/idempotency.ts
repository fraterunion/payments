import { createHash } from 'node:crypto';
import {
  IdempotencyRecordStatus,
  Prisma,
  type IdempotencyRecord,
} from '@fraterunion-payments/database';
import { LEDGER_APPLICATION_ERROR_CODES, LedgerApplicationError } from './errors.js';
import { LEDGER_POST_RESOURCE_TYPE, LEDGER_POST_SCOPE, type LedgerStore } from './types.js';

const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export function hashLedgerIdempotencyKey(value: string | undefined): string {
  if (value === undefined) {
    throw new LedgerApplicationError(
      LEDGER_APPLICATION_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
      'Idempotency-Key is required.',
    );
  }
  if (typeof value !== 'string') {
    throw new LedgerApplicationError(
      LEDGER_APPLICATION_ERROR_CODES.IDEMPOTENCY_KEY_INVALID,
      'Idempotency-Key must be a string.',
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new LedgerApplicationError(
      LEDGER_APPLICATION_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
      'Idempotency-Key is required.',
    );
  }
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new LedgerApplicationError(
      LEDGER_APPLICATION_ERROR_CODES.IDEMPOTENCY_KEY_INVALID,
      `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
    );
  }
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      throw new LedgerApplicationError(
        LEDGER_APPLICATION_ERROR_CODES.IDEMPOTENCY_KEY_INVALID,
        'Idempotency-Key must not contain control characters.',
      );
    }
  }
  return createHash('sha256').update(trimmed, 'utf8').digest('hex');
}

export function fingerprintLedgerPosting(input: {
  readonly organizationId: string;
  readonly request: Record<string, unknown>;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalizeJson({
          ...input.request,
          organizationId: input.organizationId,
          scope: LEDGER_POST_SCOPE,
        }),
      ),
      'utf8',
    )
    .digest('hex');
}

export async function resolveLedgerPostReplay(
  client: LedgerStore,
  input: {
    readonly organizationId: string;
    readonly keyHash: string;
    readonly requestFingerprint: string;
  },
): Promise<IdempotencyRecord | undefined> {
  const record = await client.idempotencyRecord.findUnique({
    where: {
      organizationId_scope_keyHash: {
        organizationId: input.organizationId,
        scope: LEDGER_POST_SCOPE,
        keyHash: input.keyHash,
      },
    },
  });
  if (record === null) {
    return undefined;
  }
  if (record.requestFingerprint !== input.requestFingerprint) {
    throw new LedgerApplicationError(
      LEDGER_APPLICATION_ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT,
      'This idempotency key was already used with a different request.',
    );
  }
  if (record.status === IdempotencyRecordStatus.IN_PROGRESS) {
    throw new LedgerApplicationError(
      LEDGER_APPLICATION_ERROR_CODES.IDEMPOTENCY_OPERATION_IN_PROGRESS,
      'This operation is already in progress. Retry the same Idempotency-Key.',
    );
  }
  return record;
}

export async function bindLedgerPostCompleted(
  client: LedgerStore,
  input: {
    readonly organizationId: string;
    readonly keyHash: string;
    readonly requestFingerprint: string;
    readonly resourceId: string;
  },
): Promise<IdempotencyRecord> {
  return client.idempotencyRecord.create({
    data: {
      organizationId: input.organizationId,
      scope: LEDGER_POST_SCOPE,
      keyHash: input.keyHash,
      requestFingerprint: input.requestFingerprint,
      resourceType: LEDGER_POST_RESOURCE_TYPE,
      resourceId: input.resourceId,
      status: IdempotencyRecordStatus.COMPLETED,
    },
  });
}

export function isLedgerIdempotencyUnique(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = `${JSON.stringify(error.meta ?? {})} ${error.message}`.toLowerCase();
  return (
    target.includes('idempotency_records') ||
    target.includes('org_scope_key') ||
    target.includes('scope_resource') ||
    target.includes('key_hash') ||
    target.includes('keyhash')
  );
}

function canonicalizeJson(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Fingerprint values must be finite numbers.');
    }
    return value;
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error(`Unsupported fingerprint value type: ${typeof value}.`);
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalizeJson(value[key]);
    }
    return sorted;
  }
  throw new Error('Unsupported fingerprint value.');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
