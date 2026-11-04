import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { AtRule, Container, PluginCreator } from 'postcss';
import selectorParser from 'postcss-selector-parser';

/**
 * The tags the runtime creates a Lynx element of the same name for. A copy of
 * `LYNX_ELEMENT_TAGS` in the runtime's lynx-document/element-tags.ts, which
 * this package can't import (it runs in Node, the runtime in Lynx), kept the
 * same by a test.
 */
export const LYNX_ELEMENT_TAGS: ReadonlySet<string> = new Set([
  'page',
  'view',
  'text',
  'raw-text',
  'inline-truncation',
  'image',
  'scroll-view',
  'list',
  'list-item',
  'block',
  'if',
  'for',
  'frame',
  'input',
  'textarea',
  'overlay',
  'svg',
  'viewpager',
  'viewpager-item',
  'refresh',
  'refresh-header',
  'title-bar-view',
  'scroll-coordinator',
  'scroll-coordinator-header',
  'scroll-coordinator-toolbar',
  'scroll-coordinator-slot',
  'scroll-coordinator-slot-drag',
  'blur-view',
  'webview',
  'video',
  'cover-view',
  'canvas',
  'comment',
]);

/**
 * The class the runtime gives an element created for a tag Lynx has no
 * element for (the runtime's `tagClassOf`).
 */
const tagClassOf = (tag: string): string => `_ngtag-${tag.toLowerCase()}`;

const rewriter = selectorParser((selectors) => {
  selectors.walkTags((tag) => {
    // `svg|path`: a namespaced tag never reaches Lynx's CSS as an element.
    if (tag.namespace !== undefined) return;
    if (LYNX_ELEMENT_TAGS.has(tag.value.toLowerCase())) return;
    tag.replaceWith(selectorParser.className({ value: tagClassOf(tag.value) }));
  });
});

/**
 * Rewrites a selector list's type selectors that name a tag Lynx has no
 * element for, such as `app-card` or `div`, to the class the runtime marks
 * the element with: `app-card > view` becomes `._ngtag-app-card > view`.
 * Selectors that can't be parsed are left as they are.
 */
export const rewriteTypeSelectors = (selector: string): string => {
  try {
    return rewriter.processSync(selector);
  } catch {
    return selector;
  }
};

/**
 * Whether a rule sits in `@keyframes`, whose `from`/`to` aren't tags.
 */
const inKeyframes = (container: Container | undefined): boolean => {
  for (let node = container; node; node = node.parent as Container) {
    if (node.type === 'atrule' && /keyframes$/i.test((node as AtRule).name)) {
      return true;
    }
  }
  return false;
};

/**
 * A PostCSS plugin that makes type selectors match the tag the template
 * wrote.
 *
 * The runtime creates an element for every tag in a template, but Lynx only
 * has its own elements (`view`, `text`, `image`): a component's host
 * (`<app-card>`) or a web tag (`<div>`) renders as a `<view>`, so a type
 * selector naming it, such as `three-d-frame { height: 100%; }`, matched
 * nothing on Lynx (Lynx's CSS matches an element's own tag, and has no way to
 * give a view another one). The runtime marks such an element with its tag's
 * class, and this rewrites the selector to that class, in component styles
 * (after Angular scoped them, so `:host`, `::ng-deep` and compound selectors
 * are already plain selectors here) and global ones alike.
 *
 * A class is more specific than a type selector, so the rewritten selector
 * can win against a class selector it would lose to on the web, when both set
 * the same property (see investigations/lynx-vs-web-differences.md).
 *
 * It runs last, at OnceExit, so it sees the rules Tailwind and the other
 * PostCSS plugins wrote.
 */
export const typeSelectorsForLynx: PluginCreator<void> = () => ({
  postcssPlugin: 'angular-lynx-type-selectors',
  OnceExit(root) {
    root.walkRules((rule) => {
      if (inKeyframes(rule.parent)) return;
      const selector = rewriteTypeSelectors(rule.selector);
      if (selector !== rule.selector) rule.selector = selector;
    });
  },
});
typeSelectorsForLynx.postcss = true;

/**
 * Adds `typeSelectorsForLynx` to every environment's PostCSS plugins: the
 * runtime marks elements the same way on native and on the web, where
 * `<lynx-view>` renders each Lynx element as its own custom element
 * (`<x-view>`), which a type selector naming the template's tag doesn't match
 * either.
 */
export const applyTypeSelectors = (api: RsbuildPluginAPI): void => {
  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
    mergeRsbuildConfig(config, {
      tools: {
        postcss: (_options, { addPlugins }) => {
          addPlugins(typeSelectorsForLynx());
        },
      },
    }),
  );
};
