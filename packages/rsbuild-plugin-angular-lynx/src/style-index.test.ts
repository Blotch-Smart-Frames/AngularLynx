import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LAYOUT_FLAG,
  RELATIVE_SIZE_FLAG,
  SMALLER_FLAG,
  VERTICAL_ALIGN_FLAG,
  parseVerticalAlign,
  styleIndexOf,
  styleIndexStatement,
} from './style-index';

const COLOR = 1;
const FONT_SIZE = 1 << 2;

describe('styleIndexOf', () => {
  it('lists the tokens each rule requires, and what it sets', () => {
    expect(
      styleIndexOf([
        '.row { display: flex } .title { color: red; font-size: 20px; margin: 0 }',
      ]).rules,
    ).toEqual([
      [['row'], LAYOUT_FLAG],
      [['title'], COLOR | FONT_SIZE],
    ]);
  });

  it('takes the last compound of each selector, with its classes, id and tag', () => {
    expect(
      styleIndexOf([
        '.card > .head.big, #main view, ._nghost-abc { color: red }',
      ]).rules,
    ).toEqual([
      [['big', 'head'], COLOR, [['>', ['card']]]],
      [['<view>'], COLOR, [[' ', ['#main']]]],
      [['_nghost-abc'], COLOR],
    ]);
  });

  // Issue #652: the runtime checks them for a Lynx <text> around an inline
  // tag, where counting a rule that doesn't apply lets the tag take its
  // ancestors' text style.
  it('keeps what each selector requires of the ancestors, nearest first', () => {
    expect(
      styleIndexOf([
        '.page .card > .head .total, ._nghost-x .total._ngcontent-x { font-size: 2px }',
      ]).rules,
    ).toEqual([
      [
        ['total'],
        FONT_SIZE,
        [
          [' ', ['head']],
          ['>', ['card']],
          [' ', ['page']],
        ],
      ],
      [['_ngcontent-x', 'total'], FONT_SIZE, [[' ', ['_nghost-x']]]],
    ]);
  });

  it('stops at a sibling, and leaves out an outer ancestor it can’t check', () => {
    expect(
      styleIndexOf([
        '.a + .b .c, .d ~ .e, [data-x] .f, :root .g { color: red }',
      ]).rules,
    ).toEqual([
      [['c'], COLOR, [[' ', ['b']]]],
      [['e'], COLOR],
      [['f'], COLOR],
      [['g'], COLOR],
    ]);
  });

  it('requires no ancestor of a nested rule that starts with a combinator', () => {
    expect(styleIndexOf(['.a { > .b { color: red } }']).rules).toEqual([
      [['b'], COLOR],
    ]);
  });

  it('marks a rule that applies only in a state, such as :active', () => {
    expect(
      styleIndexOf([
        '.a:active, .b:hover .c, .d:first-child, .e:not(:focus) { color: red }',
      ]).rules,
    ).toEqual([
      [['a'], COLOR, [], 1],
      [['c'], COLOR, [[' ', ['b']]], 1],
      [['d'], COLOR],
      [['e'], COLOR],
    ]);
  });

  it('requires nothing of an element for a selector it can’t check', () => {
    expect(
      styleIndexOf(['* { color: red } :root { color: blue }']).rules,
    ).toEqual([[[], COLOR]]);
  });

  it('leaves out what it can’t check of a compound, and comments', () => {
    expect(
      styleIndexOf(['.a[data-x]::before { /* note */ color: red }']).rules,
    ).toEqual([[['a'], COLOR]]);
  });

  it('counts an id', () => {
    expect(styleIndexOf(['#main { color: red }']).rules).toEqual([
      [['#main'], COLOR],
    ]);
  });

  it('reads a nested rule by its own selector', () => {
    expect(styleIndexOf(['.a { .b { color: red } }']).rules).toEqual([
      [['b'], COLOR],
    ]);
  });

  it('merges the rules that require the same', () => {
    expect(
      styleIndexOf([
        '.a { color: red }',
        '.a::before { font-size: 2px }',
        '.x .a { color: red }',
        '.x .a { font-size: 2px }',
        '.a:active { font-size: 2px }',
      ]).rules,
    ).toEqual([
      [['a'], COLOR | FONT_SIZE],
      [['a'], COLOR | FONT_SIZE, [[' ', ['x']]]],
      [['a'], FONT_SIZE, [], 1],
    ]);
  });

  it.each([
    ['display: flex', LAYOUT_FLAG],
    ['display: grid', LAYOUT_FLAG],
    ['display: var(--d)', LAYOUT_FLAG],
    ['linear-orientation: horizontal', LAYOUT_FLAG],
    ['linear-direction: row', LAYOUT_FLAG],
    ['display: linear', 0],
    ['display: block', 0],
    ['display: none', 0],
    ['linear-orientation: vertical', 0],
    ['--angular-lynx-color: red', 0],
    // The build's <small> rule (issue #663): a size read from the parent's
    // variable, which has no copy, gets SMALLER_FLAG in place of FONT_SIZE.
    [
      'font-size: calc(var(--angular-lynx-font-size, 14px) / 1.2)',
      SMALLER_FLAG,
    ],
    [
      'font-size: calc(var( --angular-lynx-font-size,14px ) /1.2 )',
      SMALLER_FLAG,
    ],
    // Another divisor isn't one the runtime can divide by again.
    ['font-size: calc(var(--angular-lynx-font-size, 14px) / 2)', FONT_SIZE],
    ['font-size: calc(var(--angular-lynx-font-size, 14px) / 1.25)', FONT_SIZE],
    ['font-size: calc(var(--a) / 1.2)', FONT_SIZE],
    // Nor is another fallback, or none: where no ancestor sets the variable,
    // the runtime's classes divide 14px again.
    ['font-size: calc(var(--angular-lynx-font-size, 24px) / 1.2)', FONT_SIZE],
    ['font-size: calc(var(--angular-lynx-font-size) / 1.2)', FONT_SIZE],
    // Nor is a size that adds to the variable before dividing it.
    [
      'font-size: calc((var(--angular-lynx-font-size, 14px) + 12px) / 1.2)',
      FONT_SIZE,
    ],
    ['font-size: calc(var(--angular-lynx-font-size) * 2 / 1.2)', FONT_SIZE],
    ['font-size: var(--angular-lynx-font-size-x)', FONT_SIZE],
    // A size relative to the parent's, whose copy is `1em` (issue #701).
    ['font-size: 2em', FONT_SIZE | RELATIVE_SIZE_FLAG],
    ['font-size: 80%', FONT_SIZE | RELATIVE_SIZE_FLAG],
    ['font-size: 1.25rem', FONT_SIZE],
    // A rule that sets the variable itself keeps its value, not `1em`.
    ['font-size: 2em; --angular-lynx-font-size: 20px', FONT_SIZE],
    // Any vertical-align, whose distance is in verticalAligns (issue #715).
    ['vertical-align: 0.4em', VERTICAL_ALIGN_FLAG],
    ['vertical-align: super', VERTICAL_ALIGN_FLAG],
  ])('counts %s as %s', (declaration, flags) => {
    expect(styleIndexOf([`.a { ${declaration} }`]).rules).toEqual(
      flags ? [[['a'], flags]] : [],
    );
  });

  it('leaves out keyframes, font faces and CSS it can’t parse', () => {
    expect(
      styleIndexOf([
        '@keyframes x { from { color: red } } @font-face { font-family: A }',
        '.a { color: ',
        '.b[ { color: red }',
        '.c) { color: red }',
      ]).rules,
    ).toEqual([]);
  });
});

describe('styleIndexStatement', () => {
  it('hands the index to the runtime as a global', () => {
    expect(styleIndexStatement({ rules: [[['a'], 1]] })).toBe(
      'globalThis["__angularLynxStyleIndex"]={"rules":[[["a"],1]]};',
    );
  });
});

describe('SMALLER_FLAG', () => {
  // The runtime reads the bit, so the two must agree (both sit above the
  // text properties' bits and LAYOUT_FLAG).
  it("is the runtime's bit", () => {
    const runtime = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-element/text-flow.ts',
      ),
      'utf-8',
    );
    expect(runtime).toContain('export const SMALLER_FLAG = LAYOUT_FLAG << 1;');
    expect(SMALLER_FLAG).toBe(LAYOUT_FLAG << 1);
  });

  // The runtime gives text inside nested <small>s a class of the build's for
  // its level, up to its MAX_SMALLER_LEVELS (issue #663). Each must be in the
  // build's stylesheet, dividing by 1.2 once for each level.
  it('has a class for each level of <small> the runtime names', () => {
    const runtime = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-element/text-flow.ts',
      ),
      'utf-8',
    );
    const max = Number(/MAX_SMALLER_LEVELS = (\d+);/.exec(runtime)![1]);
    const prefix = /SMALLER_CLASS_PREFIX = '([^']+)'/.exec(runtime)![1];
    const css = fs.readFileSync(
      path.join(import.meta.dirname, 'styles/html-text-tags.css'),
      'utf-8',
    );
    const classes = [
      ...css.matchAll(/\.(_ngsmaller-\d+) \{\s*font-size: ([^;]+);/g),
    ].map(([, name, value]) => [name, value]);
    expect(classes).toEqual(
      Array.from({ length: max }, (_, i) => [
        `${prefix}${i + 1}`,
        `calc(var(--angular-lynx-font-size, 14px) / ${Number(
          (1.2 ** (i + 1)).toFixed(5),
        )})`,
      ]),
    );
  });
});

describe('verticalAligns', () => {
  const verticalAligns = (...stylesheets: string[]) =>
    styleIndexOf(stylesheets).verticalAligns;

  it('is left out where no rule sets a vertical-align', () => {
    expect(styleIndexOf(['.a { color: red }'])).toEqual({
      rules: [[['a'], COLOR]],
    });
  });

  // Issue #715: the runtime moves the tags inside by the distance, so it
  // needs its value, not just a flag.
  it('lists each rule’s distance, specificity and place', () => {
    expect(
      verticalAligns(
        '.exp { vertical-align: 0.5em } .note > .mark { vertical-align: -3px }',
        '#main .x { vertical-align: super }',
      ),
    ).toEqual([
      [['exp'], [], [0.5, 0], 1000, 0, 0],
      [['mark'], [['>', ['note']]], [0, -3], 2000, 0, 1],
      [['x'], [[' ', ['#main']]], null, 1001000, 1, 2],
    ]);
  });

  it('takes the last declaration of a rule', () => {
    expect(
      verticalAligns(
        '.a { vertical-align: 1px; color: red; vertical-align: 0.2em }',
      ),
    ).toEqual([[['a'], [], [0.2, 0], 1000, 0, 0]]);
  });

  it('keeps apart rules the flags merge', () => {
    expect(
      verticalAligns(
        '.a { vertical-align: 1px }',
        '.a { vertical-align: 2px }',
      ),
    ).toEqual([
      [['a'], [], [0, 1], 1000, 0, 0],
      [['a'], [], [0, 2], 1000, 1, 1],
    ]);
  });

  // The runtime may count such a rule for an element it doesn't style, or
  // can't rank it against the others.
  it.each([
    ['an attribute', '.a[data-x]'],
    ['a structural pseudo-class', '.a:first-child'],
    ['a sibling', '.b + .a'],
    ['an ancestor it can’t check', ':root .a'],
    // Each `*` requires an ancestor (review of #735).
    ['ancestors of any kind', '* > * > .a'],
  ])('can’t copy the distance of a rule with %s', (_, selector) => {
    expect(
      verticalAligns(`${selector} { vertical-align: 1px }`)![0]![2],
    ).toBeNull();
  });

  it.each([
    ['an !important one', '.a { vertical-align: 1px !important }'],
    [
      'one in a @media',
      '@media (min-width: 1px) { .a { vertical-align: 1px } }',
    ],
    ['a nested one', '.b { .a { vertical-align: 1px } }'],
  ])('can’t copy the distance of %s', (_, css) => {
    expect(verticalAligns(css)![0]![2]).toBeNull();
  });

  it('copies the distance of a rule for any element', () => {
    expect(
      verticalAligns(
        '* { vertical-align: 1px }',
        '.b * .a { vertical-align: 2px }',
      ),
    ).toEqual([
      [[], [], [0, 1], 0, 0, 0],
      [
        ['a'],
        [
          [' ', []],
          [' ', ['b']],
        ],
        [0, 2],
        2000,
        1,
        1,
      ],
    ]);
  });

  // Neither moves the element's text as it usually draws.
  it('leaves out a state’s rule and a pseudo-element’s', () => {
    expect(
      verticalAligns(
        '.a:active { vertical-align: 1px } .b::before, .c:after { vertical-align: 1px }',
      ),
    ).toBeUndefined();
  });

  it.each([
    ['.a', 1000],
    ['view', 1],
    ['#a.b view', 1001001],
    ['.a:first-child', 2000],
    ['.a:where(.b, #c)', 1000],
    ['.a:is(.b, #c)', 1001000],
    ['.a:not(.b.c)', 3000],
    ['.a:not(:where(#b))', 1000],
  ])('ranks %s at %s', (selector, specificity) => {
    expect(verticalAligns(`${selector} { vertical-align: 1px }`)![0]![3]).toBe(
      specificity,
    );
  });
});

describe('the vertical-align flag', () => {
  const runtime = (): string =>
    fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-element/text-flow.ts',
      ),
      'utf-8',
    );

  // The runtime reads the bit, so the two must agree.
  it("is the runtime's bit", () => {
    expect(runtime()).toContain(
      'export const VERTICAL_ALIGN_FLAG = SMALLER_FLAG << 1;',
    );
    expect(VERTICAL_ALIGN_FLAG).toBe(SMALLER_FLAG << 1);
  });

  it("has the runtime's relative size bit", () => {
    expect(runtime()).toContain(
      'export const RELATIVE_SIZE_FLAG = VERTICAL_ALIGN_FLAG << 1;',
    );
    expect(RELATIVE_SIZE_FLAG).toBe(VERTICAL_ALIGN_FLAG << 1);
  });

  // The runtime reads an inline vertical-align as the build reads a rule's.
  it('reads a distance as the runtime does', () => {
    const own = fs.readFileSync(
      path.join(import.meta.dirname, 'style-index.ts'),
      'utf-8',
    );
    const body = (source: string): string =>
      /export const parseVerticalAlign = [\s\S]*?\n};\n/.exec(source)![0];
    expect(body(runtime())).toBe(body(own));
  });

  it.each([
    ['0.4em', [0.4, 0]],
    [' -0.24EM ', [-0.24, 0]],
    ['.5em', [0.5, 0]],
    ['+3px', [0, 3]],
    ['-0em', [0, 0]],
    ['0', [0, 0]],
    ['baseline', [0, 0]],
    ['super', null],
    ['50%', null],
    ['1rem', null],
    ['calc(1em + 2px)', null],
  ])('reads %s as %j', (value, distance) => {
    expect(parseVerticalAlign(value)).toEqual(distance);
  });

  // The build's <sup> and <sub> rules (issue #682), merged with their
  // smaller size's rule, as both name the tag.
  it('moves the build’s <sup> and <sub>', () => {
    const css = fs.readFileSync(
      path.join(import.meta.dirname, 'styles/html-text-tags.css'),
      'utf-8',
    );
    const index = styleIndexOf([css]);
    expect(index.rules).toEqual(
      expect.arrayContaining([
        [['<sup>'], SMALLER_FLAG | VERTICAL_ALIGN_FLAG],
        [['<sub>'], SMALLER_FLAG | VERTICAL_ALIGN_FLAG],
      ]),
    );
    expect(index.verticalAligns).toEqual([
      [['<sub>'], [], [-0.24, 0], 1, 0, 0],
      [['<sup>'], [], [0.4, 0], 1, 0, 1],
    ]);
  });
});
