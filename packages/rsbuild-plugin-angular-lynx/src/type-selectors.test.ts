import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import {
  applyTypeSelectors,
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
