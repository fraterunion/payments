import type { OutboxEvent } from '@fraterunion-payments/database';
import { TerminalEventError } from '../errors.js';

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

/**
 * One handler per event type. Duplicate registration fails immediately so
 * a misconfigured process cannot start with an ambiguous dispatch table.
 * Unknown types are a terminal configuration failure — they are not
 * retried.
 */
export class EventHandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler>();

  register(eventType: string, handler: OutboxHandler): void {
    if (eventType.trim().length === 0) {
      throw new TypeError('eventType must be non-empty.');
    }
    if (this.handlers.has(eventType)) {
      throw new Error(`Duplicate handler registration for event type "${eventType}".`);
    }
    this.handlers.set(eventType, handler);
  }

  has(eventType: string): boolean {
    return this.handlers.has(eventType);
  }

  async dispatch(event: OutboxEvent): Promise<void> {
    const handler = this.handlers.get(event.eventType);
    if (handler === undefined) {
      throw new TerminalEventError(
        `No handler registered for event type "${event.eventType}".`,
        'UNKNOWN_EVENT_TYPE',
      );
    }
    await handler(event);
  }
}
