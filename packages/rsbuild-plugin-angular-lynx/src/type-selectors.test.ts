import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { styleIndexOf } from './style-index';
import {
  ANONYMOUS_TEXT_CLASS,
  applyTypeSelectors,
  INLINE_FLOW_TAGS,
  LYNX_ELEMENT_TAGS,
  rewriteTypeSelectors,
  typeSelectorsForLynx,
} from './type-selectors';

const process = (css: string) =>
  postcss([typeSelectorsForLynx()]).process(css, { from: undefined }).css;

describe('LYNX_ELEMENT_TAGS', () => {
  // The runtime marks every element whose tag isn't in its list. A Lynx tag
  // missing from this copy would have its selectors rewritten to a class no
  // element has.
  it("is the runtime's list", () => {
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-document/element-tags.ts',
      ),
      'utf-8',
    );
    const list = /LYNX_ELEMENT_TAGS[^=]*= new Set\(\[([^\]]*)\]/.exec(
      source,
    )![1]!;
    const tags = [...list.matchAll(/'([^']+)'/g)].map(([, tag]) => tag);
    expect([...LYNX_ELEMENT_TAGS]).toEqual(tags);
  });
});

describe('INLINE_FLOW_TAGS', () => {
  // A tag the runtime puts in an anonymous <text> but missing here would
  // lose its child-combinator rules beside loose text (issue #692).
  it("is the runtime's list", () => {
    // The runtime's is its text tags but the ones it filters out.
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-document/web-tags.ts',
      ),
      'utf-8',
    );
    const quoted = (list: string): string[] =>
      [...list.matchAll(/'([^']+)'/g)].map(([, tag]) => tag!);
    const textTags = quoted(/const TEXT_TAGS = \[([^\]]*)\]/.exec(source)![1]!);
    const notInline = quoted(
      /INLINE_FLOW_TAGS[^=]*=[^[]*\[([^\]]*)\]/.exec(source)![1]!,
    );
    expect(textTags).toContain('b');
    expect(notInline).toContain('p');
    expect([...INLINE_FLOW_TAGS]).toEqual(
      textTags.filter((tag) => !notInline.includes(tag)),
    );
  });
});

describe('ANONYMOUS_TEXT_CLASS', () => {
  it("is the runtime's class", () => {
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-element/text-flow.ts',
      ),
      'utf-8',
    );
    expect(source).toContain(
      `export const ANONYMOUS_TEXT_CLASS = '${ANONYMOUS_TEXT_CLASS}';`,
    );
  });
});

describe('rewriteTypeSelectors', () => {
  it.each([
    // The issue's case: a component host, after Angular scoped the selector.
    ['three-d-frame._ngcontent-abc', '._ngtag-three-d-frame._ngcontent-abc'],
    ['app-card', '._ngtag-app-card'],
    ['div', '._ngtag-div'],
    ['app-card.active', '._ngtag-app-card.active'],
    ['app-card > view', '._ngtag-app-card > view'],
    ['view app-card + app-chart', 'view ._ngtag-app-card + ._ngtag-app-chart'],
    ['app-card:active', '._ngtag-app-card:active'],
    ['app-card::placeholder', '._ngtag-app-card::placeholder'],
    ['app-card#main', '._ngtag-app-card#main'],
    // `:host(app-card)` and `::ng-deep app-card`, as Angular scopes them.
    ['app-card._nghost-abc', '._ngtag-app-card._nghost-abc'],
    ['._ngcontent-abc app-card', '._ngcontent-abc ._ngtag-app-card'],
    ['view:not(app-card)', 'view:not(._ngtag-app-card)'],
    [':is(app-card, text)', ':is(._ngtag-app-card, text)'],
    ['app-card, view', '._ngtag-app-card, view'],
    ['App-Card', '._ngtag-app-card'],
  ])('rewrites %s', (selector, expected) => {
    expect(rewriteTypeSelectors(selector)).toBe(expected);
  });

  it.each([
    'view',
    'text.title',
    'scroll-view > list-item',
    '.app-card',
    '#div',
    '*',
    ':root',
    '[data-tag="app-card"]',
    'svg|path',
  ])('leaves %s as it is', (selector) => {
    expect(rewriteTypeSelectors(selector)).toBe(selector);
  });

  it("leaves a selector it can't parse as it is", () => {
    expect(rewriteTypeSelectors('app-card[')).toBe('app-card[');
  });

  // Issue #692: the runtime puts an inline tag beside loose text in an
  // anonymous <text>, between it and the element around the text.
  describe('a child combinator in front of what may be an inline tag', () => {
    it.each([
      ['.row > b', '.row > ._ngtag-b, .row > ._ngtext > ._ngtag-b'],
      ['.row>b', '.row>._ngtag-b, .row>._ngtext>._ngtag-b'],
      // Angular's `:host > b`, as it scopes it.
      [
        '._nghost-abc > b._ngcontent-abc',
        '._nghost-abc > ._ngtag-b._ngcontent-abc, ._nghost-abc > ._ngtext > ._ngtag-b._ngcontent-abc',
      ],
      // A class, id or `*` alone may be on an inline tag.
      ['.row > .bold', '.row > .bold, .row > ._ngtext > .bold'],
      ['.row > #total', '.row > #total, .row > ._ngtext > #total'],
      ['.row > *', '.row > *, .row > ._ngtext > *'],
      [
        '.row > :first-child',
        '.row > :first-child, .row > ._ngtext > :first-child',
      ],
      [
        '.row > span:active',
        '.row > ._ngtag-span:active, .row > ._ngtext > ._ngtag-span:active',
      ],
      [
        '.row > b::before',
        '.row > ._ngtag-b::before, .row > ._ngtext > ._ngtag-b::before',
      ],
      // A sibling of the tag is in the same anonymous <text>.
      [
        '.row > b + i',
        '.row > ._ngtag-b + ._ngtag-i, .row > ._ngtext > ._ngtag-b + ._ngtag-i',
      ],
      // One anonymous <text> at each child combinator in turn.
      [
        '.a > .b > b',
        '.a > .b > ._ngtag-b, .a > ._ngtext > .b > ._ngtag-b, .a > .b > ._ngtext > ._ngtag-b',
      ],
      [
        '.row > b, .other',
        '.row > ._ngtag-b, .row > ._ngtext > ._ngtag-b, .other',
      ],
      ['.a .row > b', '.a .row > ._ngtag-b, .a .row > ._ngtext > ._ngtag-b'],
    ])('matches %s through the anonymous <text>', (selector, expected) => {
      expect(rewriteTypeSelectors(selector)).toBe(expected);
    });

    it.each([
      // Tags that never go in an anonymous <text>, Lynx's or HTML's.
      ['.row > p', '.row > ._ngtag-p'],
      ['.row > button', '.row > ._ngtag-button'],
      ['.row > div', '.row > ._ngtag-div'],
      ['.row > app-card', '.row > ._ngtag-app-card'],
      // The theme's `view > text` doesn't style an inline tag on the web.
      ['view > text', 'view > text'],
      ['scroll-view > list-item', 'scroll-view > list-item'],
      // Nothing of its own for the selector to match.
      ['.row > ::placeholder', '.row > ::placeholder'],
      ['> b', '> ._ngtag-b'],
      // Descendants and siblings reach the tag already.
      ['.row b', '.row ._ngtag-b'],
      ['.row + b', '.row + ._ngtag-b'],
      // Inside a pseudo-class, combinators stay as they are.
      [':is(.row > b)', ':is(.row > ._ngtag-b)'],
    ])('leaves %s with no other selector', (selector, expected) => {
      expect(rewriteTypeSelectors(selector)).toBe(expected);
    });
  });
});

describe('typeSelectorsForLynx', () => {
  it("rewrites the rules' selectors", () => {
    expect(
      process(
        'app-panel { display: flex } app-chart, view { height: 100% } @media (min-width: 600px) { div { color: red } }',
      ),
    ).toBe(
      '._ngtag-app-panel { display: flex } ._ngtag-app-chart, view { height: 100% } @media (min-width: 600px) { ._ngtag-div { color: red } }',
    );
  });

  it('leaves keyframes alone', () => {
    const css =
      '@keyframes spin { from { opacity: 0 } to { opacity: 1 } } @-webkit-keyframes x { 50% { opacity: 1 } }';
    expect(process(css)).toBe(css);
  });

  it('leaves Lynx elements and classes alone', () => {
    const css = 'view.card > text { color: red } .title { color: blue }';
    expect(process(css)).toBe(css);
  });

  it('gives the style index the rule with the anonymous <text> as the tag’s parent', () => {
    // The runtime counts the rule as the <b>'s own only where Lynx applies
    // it: under the anonymous <text>, or straight under .row.
    const css = process('.row > b { color: red }');
    expect(css).toBe(
      '.row > ._ngtag-b, .row > ._ngtext > ._ngtag-b { color: red }',
    );
    expect(styleIndexOf([css]).rules).toEqual([
      [['_ngtag-b'], 1, [['>', ['row']]]],
      [
        ['_ngtag-b'],
        1,
        [
          ['>', ['_ngtext']],
          ['>', ['row']],
        ],
      ],
    ]);
  });
});

describe('applyTypeSelectors', () => {
  it("adds the plugin to every environment's PostCSS plugins", () => {
    type PostcssHook = (
      options: object,
      utils: { addPlugins: (plugin: unknown) => void },
    ) => void;
    let hook: PostcssHook | undefined;
    const api = {
      modifyRsbuildConfig: (
        handler: (
          config: object,
          utils: { mergeRsbuildConfig: (...configs: object[]) => object },
        ) => { tools: { postcss: PostcssHook } },
      ) => {
        hook = handler(
          {},
          { mergeRsbuildConfig: (_config, override) => override },
        ).tools.postcss;
      },
    };
    applyTypeSelectors(api as any);
    const addPlugins = vi.fn();
    hook!({}, { addPlugins });
    expect(addPlugins).toHaveBeenCalledWith(
      expect.objectContaining({ postcssPlugin: 'angular-lynx-type-selectors' }),
    );
  });
});
