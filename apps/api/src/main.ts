import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfigService } from './config/app-config.service';
import { EnvironmentValidationError, loadEnvironment } from './config/environment.schema';

function registerShutdownHandlers(app: INestApplication, logger: Logger, timeoutMs: number): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.log(`Received ${signal}, shutting down gracefully...`);
    const forceExitTimer = setTimeout(() => {
      logger.error(`Graceful shutdown exceeded ${timeoutMs}ms; forcing exit.`);
      process.exit(1);
    }, timeoutMs);
    forceExitTimer.unref();

    app
      .close()
      .then(() => {
        clearTimeout(forceExitTimer);
        logger.log('Shutdown complete.');
        process.exit(0);
      })
      .catch((error: unknown) => {
        clearTimeout(forceExitTimer);
        logger.error(
          `Error during shutdown: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(environment), {
    bufferLogs: true,
    bodyParser: false,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(AppConfigService);
  configureApp(app, config);

  registerShutdownHandlers(app, logger, config.shutdownTimeoutMs);

  await app.listen(config.apiPort, config.apiHost);
  logger.log(`FraterUnion Payments API listening on http://${config.apiHost}:${config.apiPort}`);
}

bootstrap().catch((error: unknown) => {
  if (error instanceof EnvironmentValidationError) {
    console.error(error.message);
  } else {
    console.error('Fatal error during bootstrap:', error);
  }
  process.exitCode = 1;
});
