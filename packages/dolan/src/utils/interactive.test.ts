import { afterEach, describe, expect, it } from 'vitest';
import { isInteractive } from './interactive';

const isTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const setIsTTY = (value: boolean | undefined) =>
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });

afterEach(() => {
  if (isTTY) Object.defineProperty(process.stdin, 'isTTY', isTTY);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
});

describe('isInteractive', () => {
  it('is true when stdin is a terminal', () => {
    setIsTTY(true);
    expect(isInteractive()).toBe(true);
  });

  it('is false when stdin is a pipe or a file', () => {
    // Node leaves `isTTY` undefined on anything but a terminal.
    setIsTTY(undefined);
    expect(isInteractive()).toBe(false);
    setIsTTY(false);
    expect(isInteractive()).toBe(false);
  });
});
