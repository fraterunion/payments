import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerShutdownHandlers } from './shutdown.js';

describe('registerShutdownHandlers', () => {
  it('invokes the handler for both SIGTERM and SIGINT', () => {
    const target = new EventEmitter() as unknown as NodeJS.Process;
    const onShutdown = vi.fn();

    registerShutdownHandlers(target, onShutdown);
    (target as unknown as EventEmitter).emit('SIGTERM');
    (target as unknown as EventEmitter).emit('SIGINT');

    expect(onShutdown).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(onShutdown).toHaveBeenNthCalledWith(2, 'SIGINT');
    expect(onShutdown).toHaveBeenCalledTimes(2);
  });
});
