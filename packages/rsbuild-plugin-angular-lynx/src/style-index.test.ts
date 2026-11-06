import { describe, expect, it } from 'vitest';
import { LAYOUT_FLAG, styleIndexOf, styleIndexStatement } from './style-index';

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
      [['big', 'head'], COLOR],
      [['<view>'], COLOR],
      [['_nghost-abc'], COLOR],
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
      styleIndexOf(['.a { color: red }', '.a:active { font-size: 2px }']).rules,
    ).toEqual([[['a'], COLOR | FONT_SIZE]]);
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
