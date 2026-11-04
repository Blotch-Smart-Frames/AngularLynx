import { describe, expect, it } from 'vitest';
import { fromWords, numbersFrom, toWords } from './words';

describe('words', () => {
  it('turns bytes into little-endian words, the count last', () => {
    expect(toWords(new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]))).toEqual([
      1, 2, 8,
    ]);
    // Unaligned, and a length that isn't a multiple of 4: padded with zeros.
    const buffer = new Uint8Array([9, 1, 2, 3, 4, 5]);
    expect(toWords(buffer.subarray(1))).toEqual([0x04030201, 5, 5]);
  });

  it('turns words back into the bytes', () => {
    expect(fromWords([0x04030201, 5, 5])).toEqual(
      new Uint8Array([1, 2, 3, 4, 5]),
    );
    expect(fromWords([])).toEqual(new Uint8Array(0));
  });

  it('reads an array-like the bridge returns as plain numbers', () => {
    expect(numbersFrom([1, '2'])).toEqual([1, 2]);
    const arrayLike = { map: (f: (v: unknown) => unknown) => [3].map(f) };
    expect(numbersFrom(arrayLike)).toEqual([3]);
    expect(numbersFrom(null)).toEqual([]);
    expect(numbersFrom(4)).toEqual([]);
  });
});
