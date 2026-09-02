import { Injectable } from '@nestjs/common';
import {
  IdempotencyRecordStatus,
  type IdempotencyRecord,
  type Prisma,
} from '@fraterunion-payments/database';
import type { DatabaseClient } from '../database/database.types';
import {
  IdempotencyKeyConflictException,
  IdempotencyOperationInProgressException,
} from './idempotency.exceptions';
import {
  asIdempotencyResourceType,
  asIdempotencyScope,
  type IdempotencyResourceType,
  type IdempotencyScope,
} from './idempotency.types';

export type IdempotencyStore = DatabaseClient | Prisma.TransactionClient;

export type IdempotencyLookupInput = {
  readonly organizationId: string;
  readonly scope: IdempotencyScope;
  readonly keyHash: string;
};

export type IdempotencyReplayInput = IdempotencyLookupInput & {
  readonly requestFingerprint: string;
};

export type BindIdempotencyInput = IdempotencyReplayInput & {
  readonly resourceType: IdempotencyResourceType;
  readonly resourceId: string;
};

/**
 * Durable financial-command idempotency. Callers own the transaction:
 * mutation, binding, and audit commit together. This service never
 * `$transaction`s or `$commit`s on its own.
 */
@Injectable()
export class IdempotencyService {
  async findExisting(
    client: IdempotencyStore,
    input: IdempotencyLookupInput,
  ): Promise<IdempotencyRecord | null> {
    return client.idempotencyRecord.findUnique({
      where: uniqueKey(input),
    });
  }

  assertFingerprint(record: IdempotencyRecord, requestFingerprint: string): void {
    if (record.requestFingerprint !== requestFingerprint) {
      throw new IdempotencyKeyConflictException();
    }
  }

  /**
   * Replay-first: existing same fingerprint returns the binding;
   * `IN_PROGRESS` is not a completed result; different fingerprint conflicts;
   * missing returns `undefined` so the caller may evaluate business rules.
   */
  async resolveReplay(
    client: IdempotencyStore,
    input: IdempotencyReplayInput,
  ): Promise<IdempotencyRecord | undefined> {
    const record = await this.findExisting(client, input);
    if (record === null) {
      return undefined;
    }
    this.assertFingerprint(record, input.requestFingerprint);
    if (record.status === IdempotencyRecordStatus.IN_PROGRESS) {
      throw new IdempotencyOperationInProgressException();
    }
    return record;
  }

  async bindCompleted(
    client: IdempotencyStore,
    input: BindIdempotencyInput,
  ): Promise<IdempotencyRecord> {
    return this.insert(client, input, IdempotencyRecordStatus.COMPLETED);
  }

  async reserveInProgress(
    client: IdempotencyStore,
    input: BindIdempotencyInput,
  ): Promise<IdempotencyRecord> {
    return this.insert(client, input, IdempotencyRecordStatus.IN_PROGRESS);
  }

  async complete(
    client: IdempotencyStore,
    input: { readonly organizationId: string; readonly operationId: string },
  ): Promise<IdempotencyRecord> {
    const record = await client.idempotencyRecord.findFirst({
      where: { id: input.operationId, organizationId: input.organizationId },
    });
    if (record === null) {
      throw new Error('Idempotency operation was not found for this organization.');
    }
    if (record.status === IdempotencyRecordStatus.COMPLETED) {
      return record;
    }
    return client.idempotencyRecord.update({
      where: { id: record.id },
      data: { status: IdempotencyRecordStatus.COMPLETED },
    });
  }

  private insert(
    client: IdempotencyStore,
    input: BindIdempotencyInput,
    status: (typeof IdempotencyRecordStatus)[keyof typeof IdempotencyRecordStatus],
  ): Promise<IdempotencyRecord> {
    const scope = asIdempotencyScope(input.scope);
    const resourceType = asIdempotencyResourceType(input.resourceType);
    return client.idempotencyRecord.create({
      data: {
        organizationId: input.organizationId,
        scope,
        keyHash: input.keyHash,
        requestFingerprint: input.requestFingerprint,
        resourceType,
        resourceId: input.resourceId,
        status,
      },
    });
  }
}

function uniqueKey(input: IdempotencyLookupInput) {
  return {
    organizationId_scope_keyHash: {
      organizationId: input.organizationId,
      scope: asIdempotencyScope(input.scope),
      keyHash: input.keyHash,
    },
  } as const;
}
