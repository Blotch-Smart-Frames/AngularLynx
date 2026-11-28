import { describe, expect, it } from 'vitest';
import { twMerge } from 'tailwind-merge';

import { cn, createCn } from './cn';

// packages/dolan's copy of these tests also checks every class the
// components use against twMerge(), that the generated config is up to
// date, and that cn.ts and cn-config.ts are the same files there.

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

  it("merges the components' kinds of classes as twMerge() does", () => {
    const merge = createCn();
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
      // Parts only kept groups have: `static` and `sticky` are `position`'s.
      'absolute static sticky',
      'table/50 block',
    ];
    for (const list of lists) {
      expect(merge(list)).toBe(twMerge(list));
    }
  });

  it('keeps a class of a group no component uses as it is', () => {
    const merge = createCn();
    expect(merge('px-2 cursor-pointer', 'px-4 cursor-default')).toBe(
      'cursor-pointer px-4 cursor-default',
    );
  });
});
