import { describe, expect, it } from 'vitest';
import { withFlatCalc } from './nested-calc';

describe('withFlatCalc', () => {
  it.each([
    ['calc(calc(100% - 16px) / 2)', 'calc((100% - 16px) / 2)'],
    ['calc(8px + calc(2px * 3))', 'calc(8px + (2px * 3))'],
    ['calc(calc(calc(1px + 2px) * 3) / 2)', 'calc(((1px + 2px) * 3) / 2)'],
    ['CALC(Calc(1px + 2px) * 3)', 'CALC((1px + 2px) * 3)'],
    // Lynx substitutes a fallback as text, inside the calc().
    ['calc(var(--x, calc(1px + 2px)) * 3)', 'calc(var(--x, (1px + 2px)) * 3)'],
    // A whole style="...": each declaration's outer calc() stays.
    [
      'width: calc(calc(100% - 16px) / 2); height: calc(1px + 2px)',
      'width: calc((100% - 16px) / 2); height: calc(1px + 2px)',
    ],
    // Other words that start with a c stay as they are.
    [
      'color: currentColor; width: calc(calc(100% - 16px) / 2)',
      'color: currentColor; width: calc((100% - 16px) / 2)',
    ],
    [
      'transform: translate(calc(calc(1px * 2) + 3px), 0)',
      'transform: translate(calc((1px * 2) + 3px), 0)',
    ],
  ])('flattens %s', (value, expected) => {
    expect(withFlatCalc(value)).toBe(expected);
  });

  it.each([
    '1px',
    'calc(1px + 2px)',
    'calc(1px + 2px) calc(3px + 4px)',
    'translate(calc(1px), calc(2px))',
    // Not a calc(): the name only ends in one.
    'calc(1px + x_calc(2px))',
    'calc(1px + my-calc(2px))',
  ])('leaves %s as it is', (value) => {
    expect(withFlatCalc(value)).toBe(value);
  });

  it("leaves anything that isn't a string as it is", () => {
    expect(withFlatCalc(0.5)).toBe(0.5);
    expect(withFlatCalc(null)).toBeNull();
  });
});
