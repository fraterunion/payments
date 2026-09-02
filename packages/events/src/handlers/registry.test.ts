import { describe, expect, it, vi } from 'vitest';
import type { OutboxEvent } from '@fraterunion-payments/database';
import { TerminalEventError } from '../errors.js';
import { EventHandlerRegistry } from './registry.js';

function event(eventType: string): OutboxEvent {
  return { id: 'event-1', eventType } as OutboxEvent;
}

describe('EventHandlerRegistry', () => {
  it('dispatches to the registered handler', async () => {
    const registry = new EventHandlerRegistry();
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register('events.test', handler);

    await registry.dispatch(event('events.test'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate registration', () => {
    const registry = new EventHandlerRegistry();
    registry.register('events.test', async () => undefined);
    expect(() => registry.register('events.test', async () => undefined)).toThrow(/Duplicate/);
  });

  it('treats an unknown event type as a terminal configuration failure', async () => {
    const registry = new EventHandlerRegistry();
    await expect(registry.dispatch(event('payment.example'))).rejects.toBeInstanceOf(
      TerminalEventError,
    );
    await expect(registry.dispatch(event('payment.example'))).rejects.toMatchObject({
      code: 'UNKNOWN_EVENT_TYPE',
    });
  });
});
