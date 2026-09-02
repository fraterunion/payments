import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { createPrismaClient, Prisma } from '@fraterunion-payments/database';
import {
  EventHandlerRegistry,
  InboxService,
  OutboxService,
  type StripeInboxAuditWrite,
} from '@fraterunion-payments/events';
import { loadWorkerEnvironment, WorkerEnvironmentValidationError } from './config/environment.js';
import { InboxWorker } from './inbox-worker.js';
import { createWorkerLogger } from './logger.js';
import { OutboxWorker } from './outbox-worker.js';
import { registerShutdownHandlers } from './shutdown.js';

for (const candidate of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'packages/database/.env'),
  resolve(process.cwd(), '../../packages/database/.env'),
]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate, override: false });
    break;
  }
}

async function bootstrap(): Promise<void> {
  const environment = loadWorkerEnvironment(process.env);
  const workerId = `worker-${randomUUID()}`;
  const logger = createWorkerLogger(environment, workerId);
  const database = createPrismaClient({ connectionString: environment.databaseUrl });

  await database.$connect();
  await database.$queryRaw`SELECT 1`;
  logger.info('Database connection established');

  const registry = new EventHandlerRegistry();
  const writeAudit: StripeInboxAuditWrite = async (client, input) => {
    await client.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  };
  const outboxWorker = new OutboxWorker({
    database,
    outbox: new OutboxService(),
    registry,
    environment,
    logger,
    workerId,
  });
  const inboxWorker = new InboxWorker({
    database,
    inbox: new InboxService(),
    environment,
    logger,
    workerId,
    writeAudit,
  });

  let shuttingDown = false;
  const shutdown = async (signal: 'SIGTERM' | 'SIGINT'): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Received shutdown signal');
    try {
      await outboxWorker.stop();
      await inboxWorker.stop();
    } finally {
      await database.$disconnect();
      logger.info('Database connection closed');
    }
    process.exit(0);
  };

  registerShutdownHandlers(process, (signal) => {
    void shutdown(signal);
  });

  await outboxWorker.start();
  await inboxWorker.start();
}

bootstrap().catch((error: unknown) => {
  if (error instanceof WorkerEnvironmentValidationError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
