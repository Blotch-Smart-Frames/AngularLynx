import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { describe, it, expect, vi } from 'vitest';

import { cn, createCn } from './cn';

const uiLib = resolve(import.meta.dirname, '../../../ui/src/lib');

/**
 * Every Tailwind class written in the `@blotch/ui` components: each word of
 * each quoted string in their code and templates that tailwind-merge takes
 * for a class, which is one it merges with a copy of itself. Words in
 * comments and other strings count too, which only errs toward the full list.
 */
const componentClasses = (): string[] => {
  const classes = new Set<string>();
  const read = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        read(path);
      } else if (/(?<!\.test)\.(ts|html)$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8');
        for (const [, text] of source.matchAll(/['"`]([^'"`\n]*)['"`]/g)) {
          for (const word of text.split(/\s+/)) {
            if (word && twMerge(`${word} ${word}`) === word) {
              classes.add(word);
            }
          }
        }
      }
    }
  };
  read(join(uiLib, 'components'));
  return [...classes].sort();
};

/**
 * A `cn()` of its own, and a spy on the full `twMerge()` it falls back to.
 */
const freshCn = () => {
  const fullMerge = vi.fn(twMerge);
  return { cn: createCn(fullMerge), fullMerge };
};

const expectTwMerge = (
  merge: ReturnType<typeof createCn>,
  ...inputs: ClassValue[]
): void => {
  expect(merge(...inputs)).toBe(twMerge(clsx(inputs)));
};

describe('cn', () => {
  it('joins plain class name strings', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values (conditional classes)', () => {
    const isActive = false;
    expect(cn('a', isActive && 'b', undefined, null, 'c')).toBe('a c');
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

  it("merges the components' classes as twMerge() does, without the full class map", () => {
    // If this fails because the full map loaded, a component uses a class
    // under a part COMPONENT_CLASS_ROOTS lacks: add the part to it, or every
    // app that copies the component in pays for the full map (#709).
    const { cn: merge, fullMerge } = freshCn();
    const classes = componentClasses();
    expect(classes.length).toBeGreaterThan(300);
    classes.forEach((className, index) => {
      expectTwMerge(
        merge,
        className,
        classes[(index * 7 + 3) % classes.length],
      );
      expectTwMerge(
        merge,
        classes.slice(index, index + 4),
        classes[(index * 13 + 5) % classes.length],
      );
    });
    expect(fullMerge).not.toHaveBeenCalled();
  });

  it('finds the group the full map does for a class under a part the components use', () => {
    // Each pair starts with a part the components use (bg, text, border,
    // rounded, inset), but the second is from a group no component uses.
    // The component map has every group under those parts, so neither class
    // is taken for the other's group.
    const { cn: merge, fullMerge } = freshCn();
    expect(merge('bg-card', 'bg-blend-multiply')).toBe(
      'bg-card bg-blend-multiply',
    );
    expect(merge('text-foreground', 'text-shadow-lg')).toBe(
      'text-foreground text-shadow-lg',
    );
    expect(merge('border-2', 'border-collapse')).toBe(
      'border-2 border-collapse',
    );
    expect(merge('rounded-lg', 'rounded-ss-none')).toBe(
      'rounded-lg rounded-ss-none',
    );
    expect(merge('inset-0', 'inset-ring-2')).toBe('inset-0 inset-ring-2');
    expect(fullMerge).not.toHaveBeenCalled();
  });

  it('merges variants, negative values, postfixes and arbitrary properties as twMerge() does', () => {
    const { cn: merge, fullMerge } = freshCn();
    expectTwMerge(merge, 'hover:px-2 px-1', 'hover:px-4');
    expectTwMerge(merge, '-mt-2', 'mt-4');
    expectTwMerge(merge, '!px-2', 'px-4 !px-6');
    expectTwMerge(merge, 'bg-primary/50', 'bg-card');
    expectTwMerge(merge, 'text-sm/6', 'leading-none text-base');
    expectTwMerge(merge, '[mask-type:luminance]', '[mask-type:alpha]');
    // Classes apps often pass to a component's `class` input.
    expectTwMerge(
      merge,
      'ml-2 mr-4 italic',
      'mx-1 not-italic size-4 space-y-2',
    );
    expectTwMerge(
      merge,
      'underline uppercase truncate',
      'no-underline normal-case line-clamp-2',
    );
    expect(fullMerge).not.toHaveBeenCalled();
  });

  it('switches to the full map for good on a class from a group the components lack', () => {
    const { cn: merge, fullMerge } = freshCn();
    expect(merge('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    expect(fullMerge).not.toHaveBeenCalled();

    // `cursor` is no component's, so the component map has no group for it.
    expect(merge('px-2 cursor-pointer', 'px-4 cursor-default')).toBe(
      'px-4 cursor-default',
    );
    expect(fullMerge).toHaveBeenCalledTimes(1);
    expect(merge('table-auto', 'table-fixed')).toBe('table-fixed');
    expect(merge('px-2', 'px-4')).toBe('px-4');
    expect(fullMerge).toHaveBeenCalledTimes(3);
  });

  it('keeps the component map for a part only kept groups have', () => {
    // `static` and `sticky` are only `position`'s, which is kept for
    // `absolute` and `relative`, so the map has all of them.
    const { cn: merge, fullMerge } = freshCn();
    expect(merge('absolute static', 'sticky')).toBe('sticky');
    expect(fullMerge).not.toHaveBeenCalled();
    // `block` is also `block-size`'s, which no component uses.
    expect(merge('block', 'block-full')).toBe(twMerge('block block-full'));
    expect(fullMerge).toHaveBeenCalledTimes(1);
  });

  it('switches to the full map on a foreign class with a postfix', () => {
    // tailwind-merge looks up `table/50` whole, then `table` without its
    // postfix, and `table` is `display: table`. Only the second is under a
    // part some group has, so both have to be checked.
    const { cn: merge, fullMerge } = freshCn();
    expect(merge('table/50', 'block')).toBe(twMerge('table/50 block'));
    expect(fullMerge).toHaveBeenCalledTimes(1);
  });

  it("is the same file as packages/ui's copy, which the components' own tests use", () => {
    expect(readFileSync(join(uiLib, 'utils/cn.ts'), 'utf8')).toBe(
      readFileSync(resolve(import.meta.dirname, 'cn.ts'), 'utf8'),
    );
  });
});
