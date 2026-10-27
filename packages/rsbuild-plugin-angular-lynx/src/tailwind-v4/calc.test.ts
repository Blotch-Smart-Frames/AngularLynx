import { describe, expect, it } from 'vitest';

import { clampHugeNumbers, foldCalc } from './calc';

describe('foldCalc', () => {
  it('folds the calc() Tailwind writes for negative and fractional values', () => {
    expect(foldCalc('calc(45deg * -1)')).toBe('-45deg');
    expect(foldCalc('calc(calc(1 / 2 * 100%) * -1)')).toBe('-50%');
    expect(foldCalc('calc(1/2*100%)')).toBe('50%');
    expect(foldCalc('skewX(calc(12deg * -1))')).toBe('skewX(-12deg)');
    expect(foldCalc('calc(0.25rem * 6)')).toBe('1.5rem');
    expect(foldCalc('calc(2px + 0px)')).toBe('2px');
    expect(foldCalc('calc(10px - 4px)')).toBe('6px');
    expect(foldCalc('calc((1 + 2) * 3px)')).toBe('9px');
    expect(foldCalc('calc(1 / 3)')).toBe('0.333333');
  });

  it('folds infinity', () => {
    expect(foldCalc('calc(infinity * 1px)')).toBe('9999px');
    expect(foldCalc('calc(-infinity * 1px)')).toBe('-9999px');
  });

  it('leaves a value without calc() alone', () => {
    expect(foldCalc('1px solid red')).toBe('1px solid red');
  });

  it("leaves a calc() it can't fold", () => {
    for (const value of [
      'calc(var(--spacing) * 4)',
      'calc(100% - 4px)',
      'calc(2px * 3px)',
      'calc(2px / 1px)',
      'calc(2px / 0)',
      'calc(2px *)',
      'calc(* 2px)',
      'calc(2px 3px)',
      'calc(foo * 2)',
      'calc(min(1px, 2px) * 2)',
      'calc("a" * 2)',
    ]) {
      expect(foldCalc(value)).toBe(value);
    }
  });
});

describe('clampHugeNumbers', () => {
  it('replaces a number with a large exponent', () => {
    expect(clampHugeNumbers('3.40282e38px')).toBe('9999px');
    expect(clampHugeNumbers('-3.40282e+38px')).toBe('-9999px');
  });

  it('keeps a small exponent and plain numbers', () => {
    expect(clampHugeNumbers('1e3px 12px')).toBe('1e3px 12px');
  });
});
