import { describe, expect, it, vi } from 'vitest';
import { twMerge } from 'tailwind-merge';

import { cn, createCn } from './cn';

// packages/dolan's copy of these tests also checks every class the
// components use against twMerge(), and that cn.ts is the same file there.

/**
 * A `cn()` of its own, and a spy on the full `twMerge()` it falls back to.
 */
const freshCn = () => {
  const fullMerge = vi.fn(twMerge);
  return { cn: createCn(fullMerge), fullMerge };
};

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes via clsx', () => {
    expect(cn('base', false, 'visible')).toBe('base visible');
  });

  it('resolves tailwind conflicts via twMerge', () => {
    expect(cn('px-4', 'px-2')).toBe('px-2');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles undefined and null inputs', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
  });

  it('handles empty inputs', () => {
    expect(cn()).toBe('');
    expect(cn('')).toBe('');
  });

  it("merges the components' kinds of classes as twMerge() does, without the full class map", () => {
    const { cn: merge, fullMerge } = freshCn();
    const lists = [
      'h-12 rounded-lg bg-primary px-4 text-base text-primary-foreground px-6 h-14',
      'hover:px-2 px-1 hover:px-4',
      '-mt-2 mt-4',
      '!px-2 px-4 !px-6',
      'bg-primary/50 bg-card',
      'text-sm/6 leading-none text-base',
      '[mask-type:luminance] [mask-type:alpha]',
      // Classes apps often pass to a component's `class` input.
      'ml-2 mr-4 italic mx-1 not-italic size-4 space-y-2',
      'underline uppercase truncate no-underline normal-case line-clamp-2',
      // Same first part as a component class, from a group none uses.
      'bg-card bg-blend-multiply',
      'text-foreground text-shadow-lg',
      'border-2 border-collapse',
    ];
    for (const list of lists) {
      expect(merge(list)).toBe(twMerge(list));
    }
    expect(fullMerge).not.toHaveBeenCalled();
  });

  it('switches to the full map for good on a class from a group the components lack', () => {
    const { cn: merge, fullMerge } = freshCn();
    expect(merge('px-2 cursor-pointer', 'px-4 cursor-default')).toBe(
      'px-4 cursor-default',
    );
    expect(merge('px-2', 'px-4')).toBe('px-4');
    expect(fullMerge).toHaveBeenCalledTimes(2);
  });

  it('switches to the full map on a foreign class with a postfix', () => {
    const { cn: merge, fullMerge } = freshCn();
    expect(merge('table/50', 'block')).toBe(twMerge('table/50 block'));
    expect(fullMerge).toHaveBeenCalledTimes(1);
  });
});
