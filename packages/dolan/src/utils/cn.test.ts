import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins plain class name strings', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values (conditional classes)', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('merges conflicting Tailwind utilities, keeping the last one', () => {
    // twMerge should resolve conflicting padding utilities to the last-wins value —
    // this is the whole reason cn() wraps clsx() with tailwind-merge instead of
    // just joining strings.
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('supports object and array syntax from clsx', () => {
    expect(cn(['a', { b: true, c: false }])).toBe('a b');
  });
});
