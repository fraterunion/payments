import { expect, it } from 'vitest';
import { GLOBALLY_UNIQUE_INBOX_SOURCES, isGloballyUniqueInboxSource } from './types.js';

it('treats stripe as a globally unique inbox source and leaves others scoped', () => {
  expect(GLOBALLY_UNIQUE_INBOX_SOURCES).toEqual(new Set(['stripe']));
  expect(isGloballyUniqueInboxSource('stripe')).toBe(true);
  expect(isGloballyUniqueInboxSource('provider.example')).toBe(false);
  expect(isGloballyUniqueInboxSource('events-test-inbox')).toBe(false);
});
