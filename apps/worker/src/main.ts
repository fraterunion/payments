import { registerShutdownHandlers } from './shutdown.js';

function bootstrap(): void {
  console.log('FraterUnion Payments worker started');

  registerShutdownHandlers(process, (signal) => {
    console.log(`Received ${signal}, shutting down gracefully`);
    process.exit(0);
  });
}

bootstrap();
