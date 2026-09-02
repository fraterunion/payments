import { RequestMethod, VersioningType, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import { json, raw, urlencoded, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { createValidationPipe } from './common/pipes/validation-pipe.factory';
import { AppConfigService } from './config/app-config.service';

const REQUEST_BODY_SIZE_LIMIT = '1mb';

export function stripeWebhookHttpPath(
  config: Pick<AppConfigService, 'apiPrefix' | 'apiVersion'>,
): string {
  return `/${config.apiPrefix}/v${config.apiVersion}/webhooks/stripe`;
}

export type RequestWithRawBody = IncomingMessage & {
  originalUrl?: string;
  rawBody?: Buffer;
};

function preserveStripeWebhookRawBody(
  config: Pick<AppConfigService, 'apiPrefix' | 'apiVersion'>,
): (req: Request, res: Response, next: NextFunction) => void {
  const webhookPath = stripeWebhookHttpPath(config);
  const rawParser = raw({ type: () => true, limit: REQUEST_BODY_SIZE_LIMIT });
  return (req, res, next) => {
    const url = typeof req.originalUrl === 'string' ? req.originalUrl : req.url;
    const path = (url ?? '').split('?')[0];
    if (path !== webhookPath) {
      next();
      return;
    }
    rawParser(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      if (Buffer.isBuffer(req.body)) {
        (req as RequestWithRawBody).rawBody = req.body;
      }
      next();
    });
  };
}

function configureSwagger(app: INestApplication, config: AppConfigService): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('FraterUnion Payments API')
      .setDescription(
        'FraterUnion Payments API. This API is under active development: endpoints, contracts, ' +
          'and authentication are not yet stable for external integration.',
      )
      .setVersion('0.1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Short-lived access token issued by POST /auth/login, /auth/register, or /auth/refresh.',
        },
        'bearer',
      )
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description:
            'Organization-scoped server-to-server API key, e.g. fup_test_<prefix>_<secret>.',
        },
        'apiKey',
      )
      .build(),
  );

  if (config.swaggerEnabled) {
    SwaggerModule.setup('docs', app, document);
  }
}

/**
 * Applies every cross-cutting HTTP concern (security headers, body limits,
 * CORS, prefix/versioning, global validation, Swagger). Shared by `main.ts`
 * and the e2e test bootstrap so tests exercise the exact same setup code
 * production traffic goes through, not a re-implementation of it.
 */
export function configureApp(app: NestExpressApplication, config: AppConfigService): void {
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  // Registered first so every request — including ones matching no
  // controller — has a request ID before anything else runs.
  app.use(requestIdMiddleware);

  app.use(helmet());
  app.use(preserveStripeWebhookRawBody(config));
  app.use(json({ limit: REQUEST_BODY_SIZE_LIMIT }));
  app.use(urlencoded({ extended: true, limit: REQUEST_BODY_SIZE_LIMIT }));
  app.disable('x-powered-by');

  app.enableCors({
    origin: [...config.corsOrigins],
    credentials: false,
  });

  app.setGlobalPrefix(config.apiPrefix, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: String(config.apiVersion) });

  app.useGlobalPipes(createValidationPipe());

  configureSwagger(app, config);
}
