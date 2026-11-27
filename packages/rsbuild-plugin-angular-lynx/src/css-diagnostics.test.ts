import { describe, expect, it } from 'vitest';
import { withoutAppliedProperties } from './css-diagnostics';

describe('withoutAppliedProperties', () => {
  const quotes = { type: 'property', name: 'quotes', line: 1, column: 5 };
  const other = { type: 'property', name: 'cursor', line: 2, column: 3 };

  // Issue #821: the runtime draws a <q>'s marks from the app's `quotes`.
  it('leaves out the diagnostics for quotes', () => {
    expect(
      JSON.parse(withoutAppliedProperties(JSON.stringify([quotes, other]))!),
    ).toEqual([other]);
    expect(
      withoutAppliedProperties(JSON.stringify([{ ...quotes, name: 'QUOTES' }])),
    ).toBe('[]');
  });

  it('keeps every other list as it is', () => {
    const list = JSON.stringify([other, { ...quotes, type: 'value' }]);
    expect(withoutAppliedProperties(list)).toBe(list);
    expect(withoutAppliedProperties(undefined)).toBeUndefined();
    expect(withoutAppliedProperties('')).toBe('');
    expect(withoutAppliedProperties('not json')).toBe('not json');
    expect(withoutAppliedProperties('{}')).toBe('{}');
    const odd = JSON.stringify([null, 1, { type: 'property' }]);
    expect(withoutAppliedProperties(odd)).toBe(odd);
  });
});
