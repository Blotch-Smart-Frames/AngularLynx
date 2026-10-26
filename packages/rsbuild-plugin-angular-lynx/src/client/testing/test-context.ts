import { vi } from 'vitest';
import type { ThreadContext } from '../hmr-protocol';

/**
 * One thread's end of the cross-thread channel, for the client tests. It
 * records what the code under test sends, and `receive()` plays a message
 * from the other thread.
 */
export const createTestContext = () => {
  const listeners = new Map<string, Array<(event: { data: string }) => void>>();
  const sent: Array<{ type: string; message: any }> = [];
  const context: ThreadContext = {
    addEventListener: vi.fn((type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }),
    dispatchEvent: vi.fn(({ type, data }) => {
      sent.push({ type, message: JSON.parse(data) });
    }),
  };
  return {
    context,
    sent,
    /** The messages of one type, in order. */
    sentOf: (type: string) =>
      sent.filter((entry) => entry.type === type).map((entry) => entry.message),
    receive: (type: string, message: object) => {
      for (const listener of listeners.get(type) ?? []) {
        listener({ data: JSON.stringify(message) });
      }
    },
  };
};
