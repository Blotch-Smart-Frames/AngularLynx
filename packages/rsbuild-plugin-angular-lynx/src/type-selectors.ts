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
 * The HTML text tags that share a line with the text beside them, which the
 * runtime puts in an anonymous `<text>` with that text. A copy of
 * `INLINE_FLOW_TAGS` in the runtime's lynx-document/web-tags.ts, kept the
 * same by a test.
 */
export const INLINE_FLOW_TAGS: ReadonlySet<string> = new Set([
  'span',
  'a',
  'label',
  'strong',
  'b',
  'em',
  'i',
  'small',
  'code',
  's',
  'u',
  'mark',
  'sub',
  'sup',
  'abbr',
  'cite',
  'q',
  'time',
  'del',
  'ins',
  'kbd',
  'samp',
  'var',
  'dfn',
]);

/**
 * The class of the anonymous `<text>` the runtime draws loose text in. A copy
 * of `ANONYMOUS_TEXT_CLASS` in the runtime's lynx-element/text-flow.ts, kept
 * the same by a test.
 */
export const ANONYMOUS_TEXT_CLASS = '_ngtext';

/**
 * The class the runtime gives an element created for a tag Lynx has no
 * element for (the runtime's `tagClassOf`).
 */
const tagClassOf = (tag: string): string => `_ngtag-${tag.toLowerCase()}`;

type SelectorNode = selectorParser.Selector['nodes'][number];

/**
 * Whether a compound can style an inline tag: it names one (`b`), or names
 * no tag at all (`.bold`, `*`). One naming another tag, such as `view`,
 * `text` or `div`, never styles an element in an anonymous `<text>` on the
 * web, so it needs no second selector: `view > text` matching every inline
 * tag beside loose text would color it as no `text` rule does on the web
 * (see the runtime's LYNX_TEXT_INHERITANCE_CLASS).
 */
const mayBeInlineTag = (compound: readonly SelectorNode[]): boolean => {
  const tag = compound.find((node) => node.type === 'tag');
  if (tag) return INLINE_FLOW_TAGS.has(tag.value.toLowerCase());
  // A pseudo-element alone, or `&`, has no element of its own to match.
  return compound.some(
    (node) =>
      node.type === 'class' ||
      node.type === 'id' ||
      node.type === 'universal' ||
      node.type === 'attribute' ||
      (node.type === 'pseudo' && !node.value.startsWith('::')),
  );
};

/**
 * Adds, after each selector with a child combinator in front of a compound
 * that can style an inline tag, the same selector with the anonymous `<text>`
 * between the two: `.row > b` gains `.row > ._ngtext > b`.
 *
 * The runtime puts an inline tag beside loose text in an anonymous `<text>`
 * (the runtime's LynxElement#regroup), so in `<div class="row">Total:
 * <b>12</b></div>` the `<b>`'s parent is that `<text>`, not the `<div>`, and
 * Lynx's CSS matched `.row > b` to nothing there, where a browser draws the
 * `<b>` red (issue #692). A lone inline tag in a row has no anonymous
 * `<text>`, so the selector stays as well. An inline tag goes in one
 * anonymous `<text>` at most, and only straight under the element around the
 * text, so each new selector has it at one combinator.
 *
 * The style index reads the new selector too (see style-index.ts), with the
 * anonymous `<text>` as the tag's parent, which is where the runtime finds it
 * (its matchedStyleFlagsFor): the runtime counts the rule as the tag's own
 * only where Lynx applies it. Combinators inside `:is()` or `:not()` are left
 * as they are.
 */
const throughAnonymousText = (selectors: selectorParser.Root): void => {
  // The selectors as they were: the new ones need no more of their own.
  for (const selector of selectors.nodes.slice()) {
    const nodes = selector.nodes;
    const extra: selectorParser.Selector[] = [];
    nodes.forEach((node, at) => {
      if (node.type !== 'combinator' || node.value.trim() !== '>') return;
      // A relative selector (`> b` in a nested rule) has no parent to match.
      if (!nodes.slice(0, at).some((before) => before.type !== 'combinator')) {
        return;
      }
      let end = at + 1;
      while (end < nodes.length && nodes[end]!.type !== 'combinator') end++;
      if (!mayBeInlineTag(nodes.slice(at + 1, end))) return;
      const copy = selector.clone();
      const combinator = copy.nodes[at]!;
      copy.insertBefore(combinator, combinator.clone());
      copy.insertBefore(
        combinator,
        selectorParser.className({ value: ANONYMOUS_TEXT_CLASS }),
      );
      // Spaced from the selector before it, as a list's selectors are.
      copy.nodes[0]!.spaces.before = ' ';
      extra.push(copy);
    });
    let after: selectorParser.Selector = selector;
    for (const copy of extra) {
      selectors.insertAfter(after, copy);
      after = copy;
    }
  }
};

const rewriter = selectorParser((selectors) => {
  // Before the tags are rewritten, which leaves an inline tag's name a class.
  throughAnonymousText(selectors);
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
 * the element with: `app-card > view` becomes `._ngtag-app-card > view`. A
 * child combinator in front of what may be an inline tag gains a selector
 * that also matches it in an anonymous `<text>` (see throughAnonymousText).
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
