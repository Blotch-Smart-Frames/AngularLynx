import postcss, { type Root } from 'postcss';
import { describe, expect, it } from 'vitest';

import {
  completeKeyframes,
  flattenNesting,
  removeEmptyContainers,
  takePropertyRegistrations,
  unwrapLayers,
} from './structure';

/**
 * Runs `step` on `css` and returns the result, formatted as normalize() does.
 */
const run = (css: string, step: (root: Root) => unknown): string => {
  const root = postcss.parse(css);
  step(root);
  return format(root);
};

/**
 * Formats CSS the same way whatever its whitespace, on one line.
 */
const normalize = (css: string) => format(postcss.parse(css));

const format = (root: Root) => {
  root.cleanRaws();
  return root
    .toString()
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*(}|$)/g, ' $1')
    .trim();
};

describe('flattenNesting', () => {
  it('resolves & and descendant selectors, in order', () => {
    expect(
      run(
        '.a { color: red; &:hover { color: blue; } .b { color: green; } }',
        flattenNesting,
      ),
    ).toBe(
      normalize(
        '.a { color: red; } .a:hover { color: blue; } .a .b { color: green; }',
      ),
    );
  });

  it('expands selector lists on both sides', () => {
    expect(
      run('.a, .b { & > .c, & + .d { color: red; } }', (root) => {
        flattenNesting(root);
        removeEmptyContainers(root);
      }),
    ).toBe(normalize('.a > .c, .a + .d, .b > .c, .b + .d { color: red; }'));
  });

  it('keeps an escaped & in a class name', () => {
    expect(
      run('.x\\&y { &:active { color: red; } }', (root) => {
        flattenNesting(root);
        removeEmptyContainers(root);
      }),
    ).toBe(normalize('.x\\&y:active { color: red; }'));
  });

  it('places deeper nesting before the next sibling', () => {
    expect(
      run('.a { &:x { &:y { color: red; } } &:z { color: blue; } }', (root) => {
        flattenNesting(root);
        removeEmptyContainers(root);
      }),
    ).toBe(normalize('.a:x:y { color: red; } .a:z { color: blue; }'));
  });

  it('moves nested at-rules out, wrapping their declarations', () => {
    expect(
      run(
        '.a { color: red; @supports (x: y) { color: blue; } @media (hover: hover) { &:hover { color: green; } } }',
        flattenNesting,
      ),
    ).toBe(
      normalize(
        '.a { color: red; } @supports (x: y) { .a { color: blue; } } @media (hover: hover) { .a:hover { color: green; } }',
      ),
    );
  });

  it('flattens at-rules nested in at-rules, and rules inside at-rules', () => {
    expect(
      run(
        '.a { @media (x) { @supports (y) { color: red; } } } @media (z) { .b { &:active { color: blue; } } }',
        (root) => {
          flattenNesting(root);
          removeEmptyContainers(root);
        },
      ),
    ).toBe(
      normalize(
        '@media (x) { @supports (y) { .a { color: red; } } } @media (z) { .b:active { color: blue; } }',
      ),
    );
  });

  it('leaves statements and empty at-rules alone', () => {
    expect(
      run('@import "x.css"; .a { @apply; color: red; }', flattenNesting),
    ).toBe(normalize('@import "x.css"; .a { color: red; } @apply;'));
  });
});

describe('unwrapLayers', () => {
  it('replaces layer blocks with their contents and drops statements', () => {
    expect(
      run(
        '@charset "utf-8"; @layer theme, utilities; @layer theme { :root { --x: 1; } } @media (x) { @layer utilities { .a { color: red; } } }',
        unwrapLayers,
      ),
    ).toBe(
      normalize(
        '@charset "utf-8"; :root { --x: 1; } @media (x) { .a { color: red; } }',
      ),
    );
  });
});

describe('takePropertyRegistrations', () => {
  it('returns the initial values and removes the registrations', () => {
    const root = postcss.parse(`
      @property --tw-a { syntax: "*"; inherits: false; initial-value: 0; }
      @property --tw-b { syntax: "*"; inherits: false; }
      .a { color: red; }
    `);
    expect([...takePropertyRegistrations(root)]).toEqual([['--tw-a', '0']]);
    expect(format(root)).toBe(normalize('.a { color: red; }'));
  });

  it("removes Tailwind's fallback for browsers without @property", () => {
    const root = postcss.parse(`
      @supports (-moz-orient: inline) {
        *, ::before, ::after, ::backdrop { --tw-a: initial; }
      }
      @supports (display: grid) { .a { display: grid; } }
      @supports (display: flex) { }
      @supports (display: flex);
    `);
    takePropertyRegistrations(root);
    expect(format(root)).toBe(
      normalize(
        '@supports (display: grid) { .a { display: grid; } } @supports (display: flex) { } @supports (display: flex);',
      ),
    );
  });
});

describe('removeEmptyContainers', () => {
  it('removes rules and at-rules left empty or with only comments', () => {
    expect(
      run(
        '.a {} .b { /* c */ } @media (x) { .c {} } .d { color: red; } @font-face { font-family: x; } @charset "utf-8";',
        removeEmptyContainers,
      ),
    ).toBe(
      normalize(
        '.d { color: red; } @font-face { font-family: x; } @charset "utf-8";',
      ),
    );
  });
});

describe('completeKeyframes', () => {
  it("adds the first and last keyframes Tailwind's animations imply", () => {
    expect(
      run(
        '@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 50% { opacity: 0.5; } } @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }',
        completeKeyframes,
      ),
    ).toBe(
      normalize(`
        @keyframes spin { from { transform: none; } to { transform: rotate(360deg); } }
        @keyframes pulse { from { opacity: 1; } 50% { opacity: 0.5; } to { opacity: 1; } }
        @keyframes ping { from { transform: none; opacity: 1; } 75%, 100% { transform: scale(2); opacity: 0; } }
      `),
    );
  });

  it('leaves complete keyframes and other properties alone', () => {
    const css =
      '@keyframes a { from { opacity: 0; } to { opacity: 1; } } @-webkit-keyframes b { 0% { width: 0; } } @keyframes c { }';
    expect(run(css, completeKeyframes)).toBe(normalize(css));
  });
});
