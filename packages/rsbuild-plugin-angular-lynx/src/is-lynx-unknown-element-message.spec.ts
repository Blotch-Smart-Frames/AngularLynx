import { describe, expect, it } from 'vitest';
import { isLynxUnknownElementMessage } from './is-lynx-unknown-element-message';

describe('isLynxUnknownElementMessage', () => {
  it('returns true for "is not a known element" messages', () => {
    expect(
      isLynxUnknownElementMessage("'view' is not a known element"),
    ).toBe(true);
  });

  it('returns true for "isn\'t a known property of" messages', () => {
    expect(
      isLynxUnknownElementMessage("'src' isn't a known property of 'image'"),
    ).toBe(true);
  });

  it('returns false for unrelated diagnostic messages', () => {
    expect(isLynxUnknownElementMessage('Type error: expected string')).toBe(
      false,
    );
  });

  it('returns false when the message is undefined', () => {
    // `text?.includes(...)` short-circuits to undefined, and the `?? false`
    // guarantees a boolean — the load-bearing behavior for the filter in
    // angular.ts which passes `PartialMessage.text` (optional).
    expect(isLynxUnknownElementMessage(undefined)).toBe(false);
  });
});
