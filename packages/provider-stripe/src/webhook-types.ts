export type VerifiedStripeWebhook = {
  readonly eventId: string;
  readonly eventType: string;
  readonly accountId?: string;
  readonly apiVersion?: string;
  readonly livemode: boolean;
  readonly createdAt?: Date;
  readonly payload: Readonly<Record<string, unknown>>;
};

export type VerifyStripeWebhookInput = {
  readonly rawBody: Buffer | string;
  readonly signature: string | undefined;
  readonly secrets: readonly string[];
};
