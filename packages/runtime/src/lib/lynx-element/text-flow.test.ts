import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_TEXT_PROPERTIES,
  ancestorTextRulesRead,
  baselineShiftFor,
  FONT_SIZE_FLAG,
  SMALLER_FLAG,
  VERTICAL_ALIGN_FLAG,
  hasAncestorTextRules,
  inheritanceStyleFor,
  inlineBaselineShift,
  isBlankText,
  isBlockDisplay,
  isRowOrientation,
  LAYOUT_FLAG,
  matchedStyleFlagsFor,
  matchedVerticalAlignFor,
  parseVerticalAlign,
  resetStyleIndex,
  type ShiftLink,
  smallerClassFor,
  styleFlagsFor,
} from './text-flow';

type Rule =
  | [string[], number]
  | [string[], number, ['>' | ' ', string[]][]]
  | [string[], number, ['>' | ' ', string[]][], 1];

type VerticalAlignRule = [
  string[],
  ['>' | ' ', string[]][],
  [number, number] | null,
  number,
  number,
  number,
];

const setIndex = (
  rules: Rule[],
  verticalAligns?: VerticalAlignRule[],
): void => {
  (
    globalThis as { __angularLynxStyleIndex?: unknown }
  ).__angularLynxStyleIndex = { rules, verticalAligns };
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
  // Issue #682: the build's <sup> and <sub> rules, as the index has them.
  const sup: ShiftLink = [SMALLER_FLAG | VERTICAL_ALIGN_FLAG, [0.4, 0]];
  const sub: ShiftLink = [SMALLER_FLAG | VERTICAL_ALIGN_FLAG, [-0.24, 0]];
  const plain: ShiftLink = [0, undefined];
  const small: ShiftLink = [SMALLER_FLAG, undefined];
  const sized: ShiftLink = [FONT_SIZE_FLAG, undefined];
  // Issue #715: an app's own rules, such as `.exp { vertical-align: 0.5em }`.
  const exp: ShiftLink = [VERTICAL_ALIGN_FLAG, [0.5, 0]];
  const pixels: ShiftLink = [VERTICAL_ALIGN_FLAG, [0, 4]];

  it.each<[string, ShiftLink[], [number, number] | null]>([
    // A tag that moves alone draws where its own rule puts it.
    ['a <sup> alone', [sup], null],
    ['text in nothing that moves', [plain, plain], null],
    // A <b> in a <sup> is as small as it, so its em is the <sup>'s.
    ['a <b> in a <sup>', [plain, sup], [0.4, 0]],
    ['an <i> in a <sub>', [plain, sub], [-0.24, 0]],
    // A <small> in a <sup> is 1.2 times smaller, so the <sup>'s distance is
    // 1.2 times as many of its em.
    ['a <small> in a <sup>', [small, sup], [0.48, 0]],
    // A <sup> in a <sup> rises by both, as in a browser.
    ['a <sup> in a <sup>', [sup, sup], [0.88, 0]],
    ['a <b> in a <sup> in a <sup>', [plain, sup, sup], [0.88, 0]],
    ['a <sup> in a <sub>', [sup, sub], [0.112, 0]],
    // A size of its own above the tags that move it changes nothing.
    ['a <b> in a <sup> in a sized tag', [plain, sup, sized], [0.4, 0]],
    // Past MAX_SMALLER_LEVELS the text stays the same size.
    [
      'a <b> in a <sup> in five <small>s',
      [plain, sup, ...Array<ShiftLink>(5).fill(small)],
      [0.4, 0],
    ],
    // Issue #715: an app's own distance moves the tags inside, in em...
    ['a <b> in an app’s tag', [plain, exp], [0.5, 0]],
    ['a <sup> in an app’s tag', [sup, exp], [1, 0]],
    ['a <b> in a <sup> in an app’s tag', [plain, sup, exp], [1, 0]],
    // ...or in pixels, which a smaller tag inside doesn't scale.
    ['a <b> in a tag raised 4px', [plain, pixels], [0, 4]],
    ['a <sup> in a tag raised 4px', [sup, pixels], [0.4, 4]],
    ['a <b> in a sized tag raised 4px', [plain, sized, pixels], [0, 4]],
    // A tag that sets its size passes it to the tags inside, which measure
    // its em by it.
    [
      'a <b> in an app’s tag with a size',
      [plain, [FONT_SIZE_FLAG | VERTICAL_ALIGN_FLAG, [0.5, 0]]],
      [0.5, 0],
    ],
    [
      'a <small> in an app’s tag with a size',
      [small, [FONT_SIZE_FLAG | VERTICAL_ALIGN_FLAG, [0.5, 0]]],
      [0.6, 0],
    ],
    [
      'a <b> in a <sup> with a size',
      [plain, [FONT_SIZE_FLAG | VERTICAL_ALIGN_FLAG, [0.4, 0]]],
      [0.4, 0],
    ],
    // A tag's own distance that brings it back to the line, and one of
    // `baseline` above it, which moves nothing.
    [
      'a <sub> back on the line in a <sup>',
      [[SMALLER_FLAG | VERTICAL_ALIGN_FLAG, [0, 0]], sup],
      [0.48, 0],
    ],
    [
      'a <sup> in a tag on the baseline',
      [sup, [VERTICAL_ALIGN_FLAG, [0, 0]]],
      null,
    ],
    // An inline size on the tag itself doesn't change the em it's moved in.
    [
      'a <sup> with an inline size in a tag raised 4px',
      [[sup[0], sup[1], true], pixels],
      [0.4, 4],
    ],
  ])('moves %s by %j', (_, chain, shift) => {
    expect(baselineShiftFor(chain)).toEqual(shift);
  });

  // A distance the runtime can't copy, and a size it can't measure the outer
  // tags' em against.
  it.each<[string, ShiftLink[]]>([
    ['a distance it can’t copy on the tag', [[VERTICAL_ALIGN_FLAG, null], sup]],
    [
      'a distance it can’t copy above it',
      [plain, [VERTICAL_ALIGN_FLAG, null], sup],
    ],
    ['a size of its own', [sized, sup]],
    ['no tags at all', []],
    // A tag between with a size of its own: the outer <sup>'s em is of a
    // size the runtime doesn't know.
    ['a size of its own between them', [plain, sized, sup]],
    ['an em distance above a sized tag', [plain, sized, exp]],
    // An inline size has no copy, so the tags inside don't take it.
    ['an inline size on the tag', [[0, undefined, true], sup]],
    ['an inline size between them', [plain, [0, undefined, true], sup]],
    [
      'an inline size on the tag that moves it',
      [plain, [sup[0], sup[1], true]],
    ],
  ])('leaves the text alone with %s', (_, chain) => {
    expect(baselineShiftFor(chain)).toBeNull();
  });
});

describe('inlineBaselineShift', () => {
  const sup: ShiftLink = [SMALLER_FLAG | VERTICAL_ALIGN_FLAG, [0.4, 0]];
  const plain: ShiftLink = [0, undefined];
  const sized: ShiftLink = [FONT_SIZE_FLAG, undefined];
  const exp: ShiftLink = [VERTICAL_ALIGN_FLAG, [0.5, 0]];
  const pixels: ShiftLink = [VERTICAL_ALIGN_FLAG, [0, 4]];
  const unknown: ShiftLink = [VERTICAL_ALIGN_FLAG, null];

  it.each<[string, ShiftLink[], [number, number] | null]>([
    ['the whole chain where it can', [plain, sup, exp], [1, 0]],
    ['a distance in pixels alone', [plain, pixels], [0, 4]],
    // Review of #735: a <b> in a <sup> inside a tag the runtime can't follow
    // rises with the <sup>'s own text.
    [
      'the <sup>’s distance, below one in pixels',
      [plain, sup, pixels],
      [0.4, 0],
    ],
    [
      'the <sup>’s distance, below one it can’t copy',
      [plain, sup, unknown],
      [0.4, 0],
    ],
    [
      'the <sup>’s distance, below an em one above a size',
      [plain, sup, sized, exp],
      [0.4, 0],
    ],
    // The <sup> itself keeps its rule's distance.
    ['nothing on the <sup> below one in pixels', [sup, pixels], null],
    ['nothing below a distance it can’t copy', [plain, unknown, sup], null],
    ['nothing for a tag alone', [sup], null],
  ])('writes %s', (_, chain, shift) => {
    expect(inlineBaselineShift(chain)).toEqual(shift);
  });
});

describe('parseVerticalAlign', () => {
  it.each<[string, [number, number] | null]>([
    ['0.4em', [0.4, 0]],
    [' -0.24EM ', [-0.24, 0]],
    ['.5em', [0.5, 0]],
    ['+3px', [0, 3]],
    ['-2.5px', [0, -2.5]],
    ['0', [0, 0]],
    ['-0em', [0, 0]],
    ['baseline', [0, 0]],
    ['super', null],
    ['middle', null],
    ['50%', null],
    ['1rem', null],
    ['calc(1em + 2px)', null],
    ['var(--x)', null],
    ['em', null],
  ])('reads %s', (value, distance) => {
    expect(parseVerticalAlign(value)).toEqual(distance);
  });
});

describe('matchedVerticalAlignFor', () => {
  const none = (): undefined => undefined;
  const ancestors =
    (...list: string[][]) =>
    (index: number) =>
      list[index] && new Set(list[index]);

  it('reads nothing without an index', () => {
    expect(matchedVerticalAlignFor(new Set(['a']), none)).toBeUndefined();
  });

  it('reads nothing where no rule matches', () => {
    setIndex([], [[['a'], [], [0.5, 0], 1000, 0, 0]]);
    expect(matchedVerticalAlignFor(new Set(['b']), none)).toBeUndefined();
    expect(matchedVerticalAlignFor(new Set(), none)).toBeUndefined();
  });

  it('reads the distance of the rule that matches', () => {
    setIndex(
      [],
      [
        [['a', 'b'], [], [0.5, 0], 2000, 0, 0],
        [[], [], [0, 2], 0, 0, 1],
      ],
    );
    expect(matchedVerticalAlignFor(new Set(['a', 'b']), none)).toEqual([
      0.5, 0,
    ]);
    expect(matchedVerticalAlignFor(new Set(['a']), none)).toEqual([0, 2]);
  });

  it('checks what the rule requires of the ancestors', () => {
    setIndex([], [[['sup'], [[' ', ['note']]], [0.3, 0], 2000, 0, 0]]);
    expect(
      matchedVerticalAlignFor(new Set(['sup']), ancestors(['p'], ['note'])),
    ).toEqual([0.3, 0]);
    expect(
      matchedVerticalAlignFor(new Set(['sup']), ancestors(['p'])),
    ).toBeUndefined();
  });

  // As Lynx ranks them: by specificity, then by their order in a stylesheet.
  it('takes the rule that wins', () => {
    setIndex(
      [],
      [
        // `.note sup` wins over the build's `sup`, whatever their order.
        [['sup'], [[' ', ['note']]], [0.3, 0], 2000, 0, 0],
        [['sup'], [], [0.4, 0], 1000, 0, 1],
        // A rule with the same specificity later in the stylesheet wins.
        [['sub'], [], [-0.24, 0], 1000, 0, 2],
        [['sub'], [], [-0.1, 0], 1000, 0, 3],
        // Whichever the runtime comes to first.
        [['y'], [], [0, 1], 1000, 0, 4],
        [['x'], [], [0, 2], 1000, 0, 5],
      ],
    );
    expect(
      matchedVerticalAlignFor(new Set(['sup']), ancestors(['note'])),
    ).toEqual([0.3, 0]);
    expect(matchedVerticalAlignFor(new Set(['sup']), none)).toEqual([0.4, 0]);
    expect(matchedVerticalAlignFor(new Set(['sub']), none)).toEqual([-0.1, 0]);
    expect(matchedVerticalAlignFor(new Set(['x', 'y']), none)).toEqual([0, 2]);
  });

  it('can’t tell the winner of two stylesheets that disagree', () => {
    setIndex(
      [],
      [
        [['a'], [], [0.5, 0], 1000, 0, 0],
        [['a'], [], [0.3, 0], 1000, 1, 1],
        [['b'], [], [0.5, 0], 1000, 0, 2],
        [['b'], [], [0.5, 0], 1000, 1, 3],
      ],
    );
    expect(matchedVerticalAlignFor(new Set(['a']), none)).toBeNull();
    // Two that agree draw the same either way.
    expect(matchedVerticalAlignFor(new Set(['b']), none)).toEqual([0.5, 0]);
  });

  it('can’t tell a distance the build couldn’t copy', () => {
    setIndex(
      [],
      [
        [['a'], [], null, 1000, 0, 0],
        // One that loses to a rule it can tell doesn't count.
        [['b'], [], null, 1000, 0, 1],
        [['b', 'c'], [], [0.5, 0], 2000, 0, 2],
      ],
    );
    expect(matchedVerticalAlignFor(new Set(['a']), none)).toBeNull();
    expect(matchedVerticalAlignFor(new Set(['b', 'c']), none)).toEqual([
      0.5, 0,
    ]);
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
