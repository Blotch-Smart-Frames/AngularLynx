import { describe, expect, it } from 'vitest';
import { LynxDOMException } from './dom-exception';

describe('LynxDOMException', () => {
  it('carries the name and its legacy code, like the DOM one Angular creates on a timeout', () => {
    const error = new LynxDOMException('signal timed out', 'TimeoutError');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('signal timed out');
    expect(error.name).toBe('TimeoutError');
    expect(error.code).toBe(23);
  });

  it("carries the code of atob's InvalidCharacterError, as the DOM one does", () => {
    const name = 'InvalidCharacterError';
    expect(new LynxDOMException('', name).code).toBe(
      new DOMException('', name).code,
    );
  });

  it('defaults to an unnamed error with code 0', () => {
    const error = new LynxDOMException();
    expect(error.message).toBe('');
    expect(error.name).toBe('Error');
    expect(error.code).toBe(0);
  });
});
