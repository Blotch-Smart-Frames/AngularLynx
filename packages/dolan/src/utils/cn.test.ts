import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { describe, it, expect } from 'vitest';

import { cn, createCn } from './cn';

const uiLib = resolve(import.meta.dirname, '../../../ui/src/lib');

/**
 * Every Tailwind class written in the `@blotch/ui` components: each word of
 * each quoted string in their code and templates that tailwind-merge takes
 * for a class, which is one it merges with a copy of itself. Words in
 * comments and other strings count too, which only errs toward the full list.
 * The icon set is left out: it's names and path data, no class, and names
 * such as `'table'` and `'filter'` read as classes.
 */
const componentClasses = (): string[] => {
  const classes = new Set<string>();
  const read = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        read(path);
      } else if (
        /(?<!\.test)\.(ts|html)$/.test(entry.name) &&
        entry.name !== 'icon-set.ts'
      ) {
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

  it("merges the components' classes as twMerge() does", () => {
    // If this fails, a component uses a class under a part
    // COMPONENT_CLASS_ROOTS (cn-config-source.ts) lacks: add the part to it
    // and run `npm run generate:cn-config -w @blotch/dolan`.
    const merge = createCn();
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
  });

  it('finds the group twMerge() does for a class under a part the components use', () => {
    // Each pair starts with a part the components use (bg, text, border,
    // rounded, inset), but the second is from a group no component uses.
    // The config has every group under those parts, so neither class is
    // taken for the other's group.
    const merge = createCn();
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
  });

  it('merges variants, negative values, postfixes and arbitrary properties as twMerge() does', () => {
    const merge = createCn();
    expectTwMerge(merge, 'hover:px-2 px-1', 'hover:px-4');
    expectTwMerge(merge, '-mt-2', 'mt-4');
    expectTwMerge(merge, '!px-2', 'px-4 !px-6');
    expectTwMerge(merge, 'bg-primary/50', 'bg-card');
    expectTwMerge(merge, 'text-sm/6', 'leading-none text-base');
    // tailwind-merge merges an arbitrary property by its name, whatever
    // config it has.
    expectTwMerge(merge, '[mask-type:luminance]', '[mask-type:alpha]');
    expectTwMerge(merge, '[cursor:pointer]', '[cursor:default]');
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
  });

  it('keeps a class of a group no component uses as it is', () => {
    // `cursor` and `rotate` are no component's, so cn() knows no group for
    // them: it keeps both, and they don't stop the classes around them
    // merging.
    const merge = createCn();
    expect(merge('px-2 cursor-pointer', 'px-4 cursor-default')).toBe(
      'cursor-pointer px-4 cursor-default',
    );
    expect(merge('rotate-45', 'rotate-90')).toBe('rotate-45 rotate-90');
    expect(twMerge('rotate-45 rotate-90')).toBe('rotate-90');
  });

  it("knows a group that shares a first part with a component's", () => {
    // `static` and `sticky` are only `position`'s, which is kept for
    // `absolute` and `relative`. `block` is also `block-size`'s, which no
    // component uses, and `table` is `table-layout`'s as well as
    // `display: table`'s: their groups are kept too.
    const merge = createCn();
    expectTwMerge(merge, 'absolute static', 'sticky');
    expectTwMerge(merge, 'block', 'block-full');
    expectTwMerge(merge, 'table-auto', 'table-fixed');
    expectTwMerge(merge, 'table/50', 'block');
  });

  it.each(['cn.ts', 'cn-config.ts'])(
    "%s is the same file as packages/ui's copy, which the components' own tests use",
    (file) => {
      expect(readFileSync(join(uiLib, 'utils', file), 'utf8')).toBe(
        readFileSync(resolve(import.meta.dirname, file), 'utf8'),
      );
    },
  );
});
