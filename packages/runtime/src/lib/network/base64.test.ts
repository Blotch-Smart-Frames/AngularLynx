import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, lynxAtob, lynxBtoa } from './base64';
import { LynxDOMException } from './dom-exception';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('bytesToBase64', () => {
  it('encodes with padding, as Node does', () => {
    for (const input of [
      bytes(),
      bytes(104),
      bytes(104, 105),
      bytes(104, 105, 33),
      bytes(0, 255, 254, 1, 128),
    ]) {
      expect(bytesToBase64(input)).toBe(Buffer.from(input).toString('base64'));
    }
  });

  it('encodes a body bigger than one slice', () => {
    const input = Uint8Array.from({ length: 20_000 }, (_, i) => i % 256);
    expect(bytesToBase64(input)).toBe(Buffer.from(input).toString('base64'));
  });
});

describe('base64ToBytes', () => {
  it('decodes what bytesToBase64 encodes', () => {
    const input = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) % 256);
    expect(base64ToBytes(bytesToBase64(input))).toEqual(input);
  });

  it('accepts text without padding and skips characters outside the alphabet', () => {
    expect(base64ToBytes('aGk')).toEqual(bytes(104, 105));
    expect(base64ToBytes('aA')).toEqual(bytes(104));
    expect(base64ToBytes('aG\nk=')).toEqual(bytes(104, 105));
  });

  it('ignores a dangling character, which encodes no whole byte', () => {
    const dangling = `${bytesToBase64(bytes(104, 105, 49))}a`;
    expect(base64ToBytes(dangling)).toEqual(bytes(104, 105, 49));
  });

  it('returns bytes backed by a buffer of exactly their length', () => {
    expect(base64ToBytes('aGk=').buffer.byteLength).toBe(2);
  });
});

describe('lynxBtoa and lynxAtob', () => {
  it('match the platform for binary strings, including a long one', () => {
    const long = String.fromCharCode(
      ...Array.from({ length: 20_000 }, (_, i) => i % 256),
    );
    for (const input of ['', 'h', 'hi', 'hi!', '\u0000\u00ff\u0080', long]) {
      expect(lynxBtoa(input)).toBe(btoa(input));
      expect(lynxAtob(btoa(input))).toBe(input);
    }
    expect(lynxBtoa(12)).toBe(btoa('12'));
  });

  it('decodes without padding and skips ASCII whitespace, as the platform does', () => {
    for (const input of ['aGk', 'aGk=', ' aG\tk\n= ', 'aGkh', 'YQ==']) {
      expect(lynxAtob(input)).toBe(atob(input));
    }
  });

  it('throws an InvalidCharacterError for text the platform rejects', () => {
    for (const input of ['a', 'aGk==', 'a===', 'aG-k', 'aGk*']) {
      expect(() => atob(input)).toThrow();
      expect(() => lynxAtob(input)).toThrow(LynxDOMException);
    }
    expect(() => lynxAtob('a')).toThrow(
      expect.objectContaining({ name: 'InvalidCharacterError' }),
    );
    expect(() => lynxBtoa('✓')).toThrow(
      expect.objectContaining({
        name: 'InvalidCharacterError',
        message: expect.stringContaining('Latin1'),
      }),
    );
  });
});
