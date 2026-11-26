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
 * `<text>`, so the selector stays as well.
 *
 * A path can pass through more than one anonymous `<text>`, when a block
 * sits in an inline tag: in `<div class="outer">Lead <a><div
 * class="inner">Total: <b>12</b></div></a></div>`, the `<a>` is in the outer
 * `<div>`'s and the `<b>` in the inner one's, so `.outer > a .inner > b`
 * needs both. So each combination of the combinators gets a selector, but
 * for one with two child combinators in a row: the compound between them
 * would be an inline tag, a `<text>`, holding an anonymous `<text>`, which
 * the runtime never makes. `.a > .b > b` gains two selectors, not three.
 *
 * The style index reads the new selectors too (see style-index.ts), with the
 * anonymous `<text>` as the tag's parent, which is where the runtime finds it
 * (its matchedStyleFlagsFor): the runtime counts the rule as the tag's own
 * only where Lynx applies it. Combinators inside `:is()` or `:not()` are left
 * as they are.
 */
/**
 * The most selectors throughAnonymousText adds for one selector. The
 * combinations grow like the Fibonacci numbers with its child combinators: a
 * selector with five gets at most 12, but one with thirty would get two
 * million, and run the build out of memory.
 */
export const MAX_ANONYMOUS_TEXT_SELECTORS = 32;

/**
 * The selectors of the current rewrite that had more combinations than
 * MAX_ANONYMOUS_TEXT_SELECTORS (see rewriteTypeSelectors).
 */
let capped: string[] = [];

const throughAnonymousText = (selectors: selectorParser.Root): void => {
  // The selectors as they were: the new ones need no more of their own.
  for (const selector of selectors.nodes.slice()) {
    const nodes = selector.nodes;
    // The child combinators an anonymous <text> may sit at, by position.
    const at: number[] = [];
    nodes.forEach((node, index) => {
      if (node.type !== 'combinator' || node.value.trim() !== '>') return;
      // A relative selector (`> b` in a nested rule) has no parent to match.
      if (
        !nodes.slice(0, index).some((before) => before.type !== 'combinator')
      ) {
        return;
      }
      let end = index + 1;
      while (end < nodes.length && nodes[end]!.type !== 'combinator') end++;
      if (mayBeInlineTag(nodes.slice(index + 1, end))) at.push(index);
    });
    /**
     * Whether two combinators have one compound between them.
     */
    const inARow = (left: number, right: number): boolean =>
      !nodes.slice(left + 1, right).some((node) => node.type === 'combinator');
    // Each combination, by the positions in it, but for two child
    // combinators in a row (see above).
    let combinations: number[][] = [[]];
    for (const index of at) {
      if (combinations.length > MAX_ANONYMOUS_TEXT_SELECTORS) break;
      combinations = [
        ...combinations,
        ...combinations
          .filter((chosen) => {
            const last = chosen[chosen.length - 1];
            return last === undefined || !inARow(last, index);
          })
          .map((chosen) => [...chosen, index]),
      ];
    }
    // The selector itself is the empty combination; the others follow it,
    // shortest first.
    combinations.shift();
    if (combinations.length > MAX_ANONYMOUS_TEXT_SELECTORS) {
      // Too many: one anonymous <text> at a time, which is every path but
      // one through a block in an inline tag, and a warning that says so.
      combinations = at.map((index) => [index]);
      capped.push(selector.toString().trim());
    }
    combinations.sort((a, b) => a.length - b.length);
    let after: selectorParser.Selector = selector;
    for (const chosen of combinations) {
      const copy = selector.clone();
      // From the right, so the positions to their left stay where they were.
      for (const index of [...chosen].reverse()) {
        const combinator = copy.nodes[index]!;
        copy.insertBefore(combinator, combinator.clone());
        copy.insertBefore(
          combinator,
          selectorParser.className({ value: ANONYMOUS_TEXT_CLASS }),
        );
      }
      // Spaced from the selector before it, as a list's selectors are.
      copy.nodes[0]!.spaces.before = ' ';
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
 * Selectors that can't be parsed are left as they are. `onCapped` hears of
 * each selector whose combinations were more than
 * MAX_ANONYMOUS_TEXT_SELECTORS, which gets one anonymous `<text>` at a time.
 */
export const rewriteTypeSelectors = (
  selector: string,
  onCapped?: (selector: string) => void,
): string => {
  capped = [];
  try {
    return rewriter.processSync(selector);
  } catch {
    return selector;
  } finally {
    for (const one of capped) onCapped?.(one);
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
  OnceExit(root, { result }) {
    root.walkRules((rule) => {
      if (inKeyframes(rule.parent)) return;
      const selector = rewriteTypeSelectors(rule.selector, (one) => {
        rule.warn(
          result,
          `\`${one}\` has too many child combinators to match through every anonymous <text> (see MAX_ANONYMOUS_TEXT_SELECTORS): an inline tag in a block inside another inline tag may miss it on Lynx.`,
        );
      });
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
