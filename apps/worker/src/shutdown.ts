export type ShutdownSignal = 'SIGTERM' | 'SIGINT';
export type ShutdownHandler = (signal: ShutdownSignal) => void;

const SHUTDOWN_SIGNALS: readonly ShutdownSignal[] = ['SIGTERM', 'SIGINT'];

export function registerShutdownHandlers(
  target: NodeJS.Process,
  onShutdown: ShutdownHandler,
): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    target.on(signal, () => {
      onShutdown(signal);
    });
  }
}
