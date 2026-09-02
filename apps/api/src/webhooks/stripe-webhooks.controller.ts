import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { RequestWithRawBody } from '../app.setup';
import { StripeWebhookInvalidPayloadException } from './stripe-webhook.exceptions';
import { StripeWebhookIngestionService } from './stripe-webhook.service';
import type { StripeWebhookAck } from './stripe-webhook.types';

@ApiTags('Webhooks')
@ApiExcludeController()
@Controller('webhooks')
export class StripeWebhooksController {
  constructor(private readonly ingestion: StripeWebhookIngestionService) {}

  @Post('stripe')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Webhook accepted.' })
  async receiveStripe(
    @Req() req: RequestWithRawBody,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<StripeWebhookAck> {
    if (req.rawBody === undefined) {
      throw new StripeWebhookInvalidPayloadException();
    }
    return this.ingestion.ingest(req.rawBody, signature);
  }
}
