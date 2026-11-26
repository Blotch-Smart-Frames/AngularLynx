import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LAYOUT_FLAG,
  SMALLER_FLAG,
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
    ['font-size: calc(var(--angular-lynx-font-size) /1.2 )', SMALLER_FLAG],
    // Another divisor isn't one the runtime can divide by again.
    ['font-size: calc(var(--angular-lynx-font-size, 14px) / 2)', FONT_SIZE],
    ['font-size: calc(var(--angular-lynx-font-size, 14px) / 1.25)', FONT_SIZE],
    ['font-size: calc(var(--a) / 1.2)', FONT_SIZE],
    // Nor is a size that adds to the variable before dividing it.
    [
      'font-size: calc((var(--angular-lynx-font-size, 14px) + 12px) / 1.2)',
      FONT_SIZE,
    ],
    ['font-size: calc(var(--angular-lynx-font-size) * 2 / 1.2)', FONT_SIZE],
    ['font-size: var(--angular-lynx-font-size-x)', FONT_SIZE],
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
