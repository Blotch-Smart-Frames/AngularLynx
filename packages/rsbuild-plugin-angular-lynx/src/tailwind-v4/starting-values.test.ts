import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { startingValueRules } from './starting-values';

const DEFAULTS = new Map([
  ['--tw-translate-x', '0'],
  ['--tw-scale-x', '1'],
  ['--tw-border-style', 'solid'],
]);

const startingValues = (css: string) =>
  startingValueRules(postcss.parse(css), DEFAULTS);

describe('startingValueRules', () => {
  it('starts only the elements that read a variable', () => {
    expect(
      startingValues(`
        .border { border-style: var(--tw-border-style); }
        .p-4 { padding: 1rem; }
      `),
    ).toEqual([{ selectors: ['.border'], variables: ['--tw-border-style'] }]);
  });

  it('leaves out the variables a rule sets itself', () => {
    expect(
      startingValues(`
        .translate-x-2 {
          --tw-translate-x: 0.5rem;
          transform: translateX(var(--tw-translate-x)) scale(var(--tw-scale-x));
        }
      `),
    ).toEqual([{ selectors: ['.translate-x-2'], variables: ['--tw-scale-x'] }]);
  });

  it('reads a variable inside a custom property and a function', () => {
    expect(
      startingValues(`.a { --x: calc(var(--tw-translate-x) * 2); }`),
    ).toEqual([{ selectors: ['.a'], variables: ['--tw-translate-x'] }]);
  });

  it('groups the elements that need the same variables', () => {
    expect(
      startingValues(`
        .border { border-style: var(--tw-border-style); }
        .border-t { border-top-style: var(--tw-border-style); }
        .scale { transform: scale(var(--tw-scale-x)); }
      `),
    ).toEqual([
      { selectors: ['.border', '.border-t'], variables: ['--tw-border-style'] },
      { selectors: ['.scale'], variables: ['--tw-scale-x'] },
    ]);
  });

  it('is as specific as one class, so the utilities that set a variable win', () => {
    // `.hover\:scale-110:hover` would outweigh `.translate-x-2`, and undo
    // its translate whenever the element is hovered.
    expect(
      startingValues(`
        .hover\\:scale-110:hover { transform: translateX(var(--tw-translate-x)); }
        .group:hover .group-hover\\:x { transform: translateX(var(--tw-translate-x)); }
        .dark .dark\\:y.dark { transform: translateX(var(--tw-translate-x)); }
        .z::placeholder { transform: translateX(var(--tw-translate-x)); }
      `)[0]?.selectors,
    ).toEqual([
      '.hover\\:scale-110',
      '.group-hover\\:x',
      // The variant's class, not the state class beside it.
      '.dark\\:y',
      '.z::placeholder',
    ]);
  });

  it('keeps the whole selector when its element has no class of its own', () => {
    expect(
      startingValues(
        `.divide-y > * + * { border-style: var(--tw-border-style); }`,
      )[0]?.selectors,
    ).toEqual(['.divide-y > * + *']);
  });

  it('starts every element with what a keyframe reads', () => {
    // The element it animates is in no selector here.
    expect(
      startingValues(`
        @keyframes grow { to { transform: scale(var(--tw-scale-x)); } }
        .scale { transform: scale(var(--tw-scale-x)) translateX(var(--tw-translate-x)); }
        .scale-only { transform: scale(var(--tw-scale-x)); }
      `),
    ).toEqual([
      { selectors: ['*'], variables: ['--tw-scale-x'] },
      { selectors: ['.scale'], variables: ['--tw-translate-x'] },
    ]);
  });

  it('ignores variables without a starting value', () => {
    expect(
      startingValues(
        `.blur { /* a comment */ filter: var(--tw-blur,) var(); }`,
      ),
    ).toEqual([]);
  });
});
