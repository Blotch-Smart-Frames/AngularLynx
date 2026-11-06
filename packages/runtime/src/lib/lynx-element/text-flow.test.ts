import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_TEXT_PROPERTIES,
  inheritanceStyleFor,
  isBlankText,
  isBlockDisplay,
  isRowOrientation,
  LAYOUT_FLAG,
  resetStyleIndex,
  styleFlagsFor,
} from './text-flow';

const setIndex = (rules: [string[], number][]): void => {
  (
    globalThis as { __angularLynxStyleIndex?: unknown }
  ).__angularLynxStyleIndex = { rules };
  resetStyleIndex();
};

afterEach(() => {
  delete (globalThis as { __angularLynxStyleIndex?: unknown })
    .__angularLynxStyleIndex;
  resetStyleIndex();
});

describe('styleFlagsFor', () => {
  it('counts the rules whose tokens the element has, all of them', () => {
    setIndex([
      [['a'], 1],
      [['a', 'b'], 2],
      [['c'], LAYOUT_FLAG],
    ]);
    expect(styleFlagsFor(new Set(['a']))).toBe(1);
    expect(styleFlagsFor(new Set(['a', 'b']))).toBe(3);
    expect(styleFlagsFor(new Set(['c', '<view>']))).toBe(LAYOUT_FLAG);
    expect(styleFlagsFor(new Set(['d']))).toBe(0);
  });

  it('counts a rule that requires nothing for every element', () => {
    setIndex([[[], 4]]);
    expect(styleFlagsFor(new Set(['<text>']))).toBe(4);
  });

  describe('without an index', () => {
    it('takes any class of the app’s for one that may set a text style', () => {
      expect(styleFlagsFor(new Set(['title']))).toBe(ALL_TEXT_PROPERTIES);
    });

    it('leaves out the classes the renderer adds, and the tag', () => {
      expect(
        styleFlagsFor(
          new Set([
            '_ngcontent-a',
            '_nghost-b',
            '_ngtag-p',
            '_ngtext',
            '<text>',
          ]),
        ),
      ).toBe(0);
    });

    it('takes a display utility, with a variant, for a layout change', () => {
      expect(styleFlagsFor(new Set(['md:flex'])) & LAYOUT_FLAG).toBe(
        LAYOUT_FLAG,
      );
      expect(styleFlagsFor(new Set(['grid'])) & LAYOUT_FLAG).toBe(LAYOUT_FLAG);
      expect(styleFlagsFor(new Set(['p-4'])) & LAYOUT_FLAG).toBe(0);
    });
  });
});

describe('inheritanceStyleFor', () => {
  it('reads a variable for each property the element doesn’t set', () => {
    expect(inheritanceStyleFor(ALL_TEXT_PROPERTIES & ~1)).toBe(
      'color: var(--angular-lynx-color)',
    );
    expect(inheritanceStyleFor(ALL_TEXT_PROPERTIES)).toBe('');
    expect(inheritanceStyleFor(0).split('; ')).toHaveLength(11);
  });
});

describe('isBlockDisplay', () => {
  it.each([undefined, null, '', 'linear', 'block', ' Flow-Root ', 'none'])(
    'takes %s for a block',
    (display) => {
      expect(isBlockDisplay(display)).toBe(true);
    },
  );

  it.each(['flex', 'grid', 'relative', 'var(--d)'])(
    'takes %s for another layout',
    (display) => {
      expect(isBlockDisplay(display)).toBe(false);
    },
  );
});

describe('isRowOrientation', () => {
  it.each([
    ['horizontal', true],
    ['horizontal-reverse', true],
    ['row', true],
    ['vertical', false],
    [undefined, false],
  ])('takes %s for a row: %s', (orientation, row) => {
    expect(isRowOrientation(orientation)).toBe(row);
  });
});

describe('isBlankText', () => {
  it.each([
    [undefined, true],
    ['', true],
    [' ', true],
    ['\t\n', true],
    [' ', false],
    ['a', false],
  ])('takes %j for blank: %s', (text, blank) => {
    expect(isBlankText(text)).toBe(blank);
  });
});
