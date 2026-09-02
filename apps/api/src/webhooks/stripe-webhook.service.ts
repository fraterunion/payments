import { Injectable } from '@nestjs/common';
import { InboxService, type InboxReceiveKind } from '@fraterunion-payments/events';
import type { Prisma } from '@fraterunion-payments/database';
import {
  STRIPE_PROVIDER_CODE,
  verifyStripeWebhook,
  type VerifiedStripeWebhook,
} from '@fraterunion-payments/provider-stripe';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import {
  mapStripeWebhookError,
  StripeWebhookInvalidPayloadException,
  StripeWebhookNotConfiguredException,
} from './stripe-webhook.exceptions';
import { STRIPE_INBOX_SOURCE, type StripeWebhookAck } from './stripe-webhook.types';

const ACK: StripeWebhookAck = { received: true };

@Injectable()
export class StripeWebhookIngestionService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly inbox: InboxService,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StripeWebhookIngestionService.name);
  }

  async ingest(rawBody: unknown, signature: string | undefined): Promise<StripeWebhookAck> {
    const secrets = this.config.stripeWebhookSecrets;
    if (secrets.length === 0) {
      throw new StripeWebhookNotConfiguredException();
    }
    if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') {
      throw new StripeWebhookInvalidPayloadException();
    }

    let verified: VerifiedStripeWebhook;
    try {
      verified = verifyStripeWebhook({
        rawBody,
        signature,
        secrets,
      });
    } catch (error) {
      this.logger.warn({ provider: 'stripe' }, 'Stripe webhook verification failed');
      throw mapStripeWebhookError(error) ?? new StripeWebhookInvalidPayloadException();
    }

    const db = this.databaseService.getClient();
    const resolved = await this.resolveTenant(verified.accountId);
    const existingIdentity = await db.inboxEvent.findFirst({
      where: {
        source: STRIPE_INBOX_SOURCE,
        externalEventId: verified.eventId,
      },
      select: { organizationId: true },
    });
    const organizationId =
      existingIdentity !== null
        ? (existingIdentity.organizationId ?? undefined)
        : resolved.organizationId;

    const result = await this.inbox.receive(db, {
      source: STRIPE_INBOX_SOURCE,
      externalEventId: verified.eventId,
      eventType: verified.eventType,
      payload: verified.payload as Prisma.InputJsonValue,
      ...(organizationId !== undefined ? { organizationId } : {}),
    });

    this.logReceipt(verified, resolved, result.kind);
    return ACK;
  }

  private async resolveTenant(accountId: string | undefined): Promise<{
    readonly organizationId?: string;
    readonly connectionId?: string;
    readonly unresolvedAccount: boolean;
  }> {
    if (accountId === undefined) {
      return { unresolvedAccount: false };
    }
    const connection = await this.databaseService.getClient().providerAccountConnection.findUnique({
      where: {
        provider_providerAccountId: {
          provider: STRIPE_PROVIDER_CODE,
          providerAccountId: accountId,
        },
      },
    });
    if (connection === null) {
      return { unresolvedAccount: true };
    }
    return {
      organizationId: connection.organizationId,
      connectionId: connection.id,
      unresolvedAccount: false,
    };
  }

  private logReceipt(
    verified: VerifiedStripeWebhook,
    resolved: {
      readonly organizationId?: string;
      readonly connectionId?: string;
      readonly unresolvedAccount: boolean;
    },
    kind: InboxReceiveKind,
  ): void {
    const fields = {
      provider: 'stripe',
      eventId: verified.eventId,
      eventType: verified.eventType,
      livemode: verified.livemode,
      outcome: kind.toLowerCase(),
      unresolvedAccount: resolved.unresolvedAccount,
      ...(resolved.organizationId !== undefined ? { organizationId: resolved.organizationId } : {}),
      ...(resolved.connectionId !== undefined ? { connectionId: resolved.connectionId } : {}),
    };
    if (kind === 'CONFLICT') {
      this.logger.warn(fields, 'Stripe webhook payload conflict; original inbox row retained');
      return;
    }
    this.logger.info(fields, 'Stripe webhook ingested');
  }
}
