import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_TEXT_PROPERTIES,
  ancestorTextRulesRead,
  baselineShiftFor,
  FONT_SIZE_FLAG,
  LOWERED_FLAG,
  RAISED_FLAG,
  SMALLER_FLAG,
  VERTICAL_ALIGN_FLAG,
  hasAncestorTextRules,
  inheritanceCopiesFor,
  inheritanceStyleFor,
  inlineTextStyles,
  splitDeclarations,
  isBlankText,
  isBlockDisplay,
  isRowOrientation,
  LAYOUT_FLAG,
  matchedStyleFlagsFor,
  resetStyleIndex,
  smallerClassFor,
  styleFlagsFor,
  textPropertyBit,
  textPropertyFlags,
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

  it('counts a state’s rule when asked, still checking its ancestors', () => {
    setIndex([[['a'], 1, [[' ', ['card']]], 1]]);
    expect(matchedStyleFlagsFor(new Set(['a']), up(['card']), true)).toBe(1);
    expect(matchedStyleFlagsFor(new Set(['a']), up(['row']), true)).toBe(0);
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

describe('ancestorTextRulesRead', () => {
  it('says whether a text property’s rule requires a token of an ancestor', () => {
    expect(ancestorTextRulesRead(['card'])).toBe(false);
    setIndex([
      [['a'], 1, [[' ', ['row']]]],
      [
        ['b'],
        1,
        [
          ['>', ['cell', '#main']],
          [' ', ['card']],
        ],
      ],
      [['c'], LAYOUT_FLAG, [[' ', ['dark']]]],
    ]);
    expect(ancestorTextRulesRead(['row'])).toBe(true);
    expect(ancestorTextRulesRead(['x', '#main'])).toBe(true);
    expect(ancestorTextRulesRead(new Set(['card']))).toBe(true);
    // Neither a layout rule's ancestor nor a rule's own tokens count.
    expect(ancestorTextRulesRead(['dark', 'a', 'b'])).toBe(false);
    expect(ancestorTextRulesRead([])).toBe(false);
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

describe('inlineTextStyles', () => {
  it('reads the text styles of a style string, the last of each', () => {
    expect(
      inlineTextStyles(
        'Color: red; padding: 4px; font-size:18px;; color: blue; line-height:',
        null,
      ),
    ).toEqual(
      new Map([
        ['color', 'blue'],
        ['font-size', '18px'],
      ]),
    );
  });

  it('lets [style.x] styles win over the string', () => {
    expect(
      inlineTextStyles(
        'color: red',
        new Map<string, unknown>([
          ['color', 'blue'],
          ['margin', '4px'],
          ['font-size', null],
          ['font-weight', ''],
          ['line-height', 20],
        ]),
      ),
    ).toEqual(
      new Map([
        ['color', 'blue'],
        ['line-height', '20'],
      ]),
    );
  });

  it('is null when there are none', () => {
    expect(inlineTextStyles(null, null)).toBeNull();
    expect(inlineTextStyles('padding: 4px', new Map())).toBeNull();
  });
});

describe('splitDeclarations', () => {
  it('splits at each ; outside quotes and parentheses', () => {
    expect(
      splitDeclarations(
        `--label: "a;b"; content: 'c;\\'d'; background: url(data:x;base64,e); color: red`,
      ),
    ).toEqual([
      '--label: "a;b"',
      " content: 'c;\\'d'",
      ' background: url(data:x;base64,e)',
      ' color: red',
    ]);
  });

  it('reads a stray ) as nothing', () => {
    expect(splitDeclarations('a: b); c: d')).toEqual(['a: b)', ' c: d']);
  });
});

describe('textPropertyFlags', () => {
  it('has the bit of each property', () => {
    expect(textPropertyBit('color')).toBe(1);
    expect(textPropertyBit('padding')).toBe(0);
    expect(textPropertyFlags(null)).toBe(0);
    expect(
      textPropertyFlags(
        new Map([
          ['color', 'red'],
          ['font-size', '1rem'],
        ]),
      ),
    ).toBe(1 | textPropertyBit('font-size'));
  });
});

describe('inheritanceCopiesFor', () => {
  it('copies each value to its variable, without !important', () => {
    expect(
      inheritanceCopiesFor(
        new Map([
          ['color', 'var(--primary) !important'],
          ['font-size', '18px'],
        ]),
      ),
    ).toBe(
      '--angular-lynx-color: var(--primary); --angular-lynx-font-size: 18px',
    );
  });

  it('copies no value that reads its own variable', () => {
    expect(
      inheritanceCopiesFor(
        new Map([
          ['font-size', 'calc(var( --angular-lynx-font-size, 14px) * 2)'],
          ['color', 'var(--angular-lynx-color-x)'],
        ]),
      ),
    ).toBe('--angular-lynx-color: var(--angular-lynx-color-x)');
    expect(inheritanceCopiesFor(null)).toBe('');
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

describe('baselineShiftFor', () => {
  // Issue #682: the build's <sup> and <sub> rules, as the index flags them.
  const sup = SMALLER_FLAG | RAISED_FLAG;
  const sub = SMALLER_FLAG | LOWERED_FLAG;

  it.each([
    // A tag that moves alone draws where its own rule puts it.
    ['a <sup> alone', [sup], null],
    ['text in nothing that moves', [0, 0], null],
    // A <b> in a <sup> is as small as it, so its em is the <sup>'s.
    ['a <b> in a <sup>', [0, sup], 0.4],
    ['an <i> in a <sub>', [0, sub], -0.24],
    // A <small> in a <sup> is 1.2 times smaller, so the <sup>'s distance is
    // 1.2 times as many of its em.
    ['a <small> in a <sup>', [SMALLER_FLAG, sup], 0.48],
    // A <sup> in a <sup> rises by both, as in a browser.
    ['a <sup> in a <sup>', [sup, sup], 0.88],
    ['a <b> in a <sup> in a <sup>', [0, sup, sup], 0.88],
    ['a <sup> in a <sub>', [sup, sub], 0.112],
    // A size of its own above the tags that move it changes nothing.
    ['a <b> in a <sup> in a sized tag', [0, sup, FONT_SIZE_FLAG], 0.4],
    // Past MAX_SMALLER_LEVELS the text stays the same size.
    [
      'a <b> in a <sup> in five <small>s',
      [0, sup, ...Array<number>(5).fill(SMALLER_FLAG)],
      0.4,
    ],
  ])('moves %s by %s em', (_, chain, shift) => {
    expect(baselineShiftFor(chain)).toBe(shift);
  });

  // An app's own vertical-align moves the text by a distance the runtime
  // doesn't know, and a size of the tag's own isn't one it can measure the
  // outer tags' em against.
  it.each([
    ['an app’s vertical-align on the tag', [VERTICAL_ALIGN_FLAG, sup]],
    ['an app’s vertical-align above it', [0, VERTICAL_ALIGN_FLAG | sup]],
    ['a size of its own', [FONT_SIZE_FLAG, sup]],
    ['no flags at all', []],
    // An app's rule for the tag sets the other distance too (review of #714).
    ['both distances on a tag above it', [0, sup | LOWERED_FLAG]],
    // A tag between with a size of its own: the outer <sup>'s em is of a
    // size the runtime doesn't know.
    ['a size of its own between them', [0, FONT_SIZE_FLAG, sup]],
    ['a size of its own on the tag that moves it', [0, FONT_SIZE_FLAG | sup]],
  ])('leaves the text alone with %s', (_, chain) => {
    expect(baselineShiftFor(chain)).toBeNull();
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
