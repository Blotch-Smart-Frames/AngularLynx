import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_TEXT_PROPERTIES,
  hasAncestorTextRules,
  inheritanceStyleFor,
  isBlankText,
  isBlockDisplay,
  isRowOrientation,
  LAYOUT_FLAG,
  matchedStyleFlagsFor,
  resetStyleIndex,
  smallerClassFor,
  styleFlagsFor,
} from './text-flow';

type Rule =
  | [string[], number]
  | [string[], number, ['>' | ' ', string[]][]]
  | [string[], number, ['>' | ' ', string[]][], 1];

const setIndex = (rules: Rule[]): void => {
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

// Issue #652: what a selector requires of the element's ancestors, checked
// for a Lynx <text> around an inline tag.
describe('matchedStyleFlagsFor', () => {
  /**
   * An element's ancestors, nearest first, as matchedStyleFlagsFor reads
   * them.
   */
  const up =
    (...ancestors: string[][]) =>
    (index: number): ReadonlySet<string> | undefined =>
      ancestors[index] && new Set(ancestors[index]);

  it('counts a rule only when the ancestors it requires are there', () => {
    setIndex([
      [['total'], 1, [[' ', ['card']]]],
      [['total'], 2],
    ]);
    const total = new Set(['total']);
    expect(matchedStyleFlagsFor(total, up(['row'], ['card', 'big']))).toBe(3);
    expect(matchedStyleFlagsFor(total, up(['row'], ['page']))).toBe(2);
    // styleFlagsFor still counts it, wherever the element is.
    expect(styleFlagsFor(total)).toBe(3);
  });

  it('requires a child’s parent to be the next one up', () => {
    setIndex([[['price'], 1, [['>', ['row']]]]]);
    const price = new Set(['price']);
    expect(matchedStyleFlagsFor(price, up(['row']))).toBe(1);
    expect(matchedStyleFlagsFor(price, up(['cell'], ['row']))).toBe(0);
    expect(matchedStyleFlagsFor(price, up())).toBe(0);
  });

  it('tries each ancestor for a descendant, past a nearer one that fails', () => {
    // `.a > .b .c`: the nearer .b's parent isn't .a, the farther one's is.
    setIndex([
      [
        ['c'],
        1,
        [
          [' ', ['b']],
          ['>', ['a']],
        ],
      ],
    ]);
    expect(
      matchedStyleFlagsFor(new Set(['c']), up(['b'], ['x'], ['b'], ['a'])),
    ).toBe(1);
    expect(matchedStyleFlagsFor(new Set(['c']), up(['b'], ['x'], ['a']))).toBe(
      0,
    );
  });

  it('checks a rule whose last part requires nothing, and every token', () => {
    setIndex([
      [[], 1, [['>', ['row']]]],
      [['a', 'b'], 2],
    ]);
    expect(matchedStyleFlagsFor(new Set(['a', 'b']), up(['row']))).toBe(3);
    expect(matchedStyleFlagsFor(new Set(['a']), up(['cell']))).toBe(0);
  });

  it('leaves out a rule that applies only in a state, such as :active', () => {
    setIndex([[['a'], 1, [], 1]]);
    expect(matchedStyleFlagsFor(new Set(['a']), up())).toBe(0);
    expect(styleFlagsFor(new Set(['a']))).toBe(1);
  });

  it('guesses as styleFlagsFor does without an index', () => {
    expect(matchedStyleFlagsFor(new Set(['title']), up())).toBe(
      ALL_TEXT_PROPERTIES,
    );
  });
});

describe('hasAncestorTextRules', () => {
  it('says whether a rule that sets a text property requires an ancestor', () => {
    expect(hasAncestorTextRules()).toBe(false);
    setIndex([
      [['a'], 1],
      [['b'], LAYOUT_FLAG, [[' ', ['row']]]],
    ]);
    expect(hasAncestorTextRules()).toBe(false);
    setIndex([[['a'], 1, [[' ', ['card']]]]]);
    expect(hasAncestorTextRules()).toBe(true);
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

describe('smallerClassFor', () => {
  // Issue #663: the build has a class for each level of <small>, up to
  // MAX_SMALLER_LEVELS, past which the text stays at that size.
  it.each([
    [1, '_ngsmaller-1'],
    [2, '_ngsmaller-2'],
    [5, '_ngsmaller-5'],
    [9, '_ngsmaller-5'],
  ])('names the class for %s levels', (levels, name) => {
    expect(smallerClassFor(levels)).toBe(name);
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
