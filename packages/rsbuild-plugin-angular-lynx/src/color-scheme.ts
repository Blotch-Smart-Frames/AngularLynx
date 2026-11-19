import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { AtRule, Container, PluginCreator, Root, Rule } from 'postcss';
import selectorParser, { type Selector } from 'postcss-selector-parser';

/**
 * The class the runtime gives `page` while the app is drawn dark. A copy of
 * `DARK_CLASS` in the runtime's lynx-document/page-color-scheme.ts, which
 * this package can't import (it runs in Node, the runtime in Lynx), kept the
 * same by a test.
 */
export const DARK_CLASS = 'dark';

/** A color scheme a media query can ask for. */
type ColorScheme = 'dark' | 'light';

/**
 * A media query that asks for a color scheme and nothing else, as Tailwind
 * writes it for `dark:` (`(prefers-color-scheme: dark)`, or
 * `(prefers-color-scheme:dark)` minified), optionally after a media type
 * every phone matches (`screen and …`). One with any other condition, such
 * as a width, is left as it is: Lynx couldn't apply the rest of it.
 */
const COLOR_SCHEME_QUERY =
  /^\s*(?:(?:only\s+)?(?:all|screen)\s+and\s+)?\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)\s*$/i;

/**
 * What the page matches while the app is drawn in each scheme: the `dark`
 * class, or not having it.
 */
const PAGE_CONDITION: Record<ColorScheme, string> = {
  dark: `.${DARK_CLASS}`,
  light: `:not(.${DARK_CLASS})`,
};

/**
 * Whether a node of a selector's first compound stands for the page: the
 * `page` element, or `:root`, which matches it on Lynx.
 */
const isPage = (node: selectorParser.Node): boolean =>
  (node.type === 'tag' && node.value.toLowerCase() === 'page') ||
  (node.type === 'pseudo' &&
    node.value.toLowerCase() === ':root' &&
    node.nodes.length === 0);

/**
 * Makes `selector` match only while the app is drawn in `scheme`.
 *
 * A selector for the page itself, such as `:root` or `page > view`, gains the
 * condition on the page: `page.dark`, `page.dark > view`. `:root` becomes
 * `page`, which matches the same element on Lynx and in the web preview,
 * where `page.dark` is known to work (the @blotch/ui theme uses it). Any
 * other selector becomes a descendant of the page: `.card` becomes
 * `page.dark .card`.
 */
const scopeSelector = (selector: Selector, scheme: ColorScheme): void => {
  const first = selector.first;
  // An empty selector, as before the comma in `,.a`, has nothing to scope.
  if (!first) return;
  const firstCompound: selectorParser.Node[] = [];
  for (const node of selector.nodes) {
    if (node.type === 'combinator') break;
    firstCompound.push(node);
  }
  const page = firstCompound.find(isPage);
  // `html:root` has a tag that isn't the page's, so `page` can't take the
  // place of its `:root` (it would match nothing on Lynx anyway).
  const otherTag = firstCompound.some(
    (node) => node.type === 'tag' && node !== page,
  );
  const condition = selectorParser()
    .astSync(`page${PAGE_CONDITION[scheme]}`)
    .first.nodes.map((node) => node.clone());
  // The space after a comma in a list belongs to the selector's first node,
  // and has to stay in front of the selector.
  const leading = first.spaces.before;
  first.spaces.before = '';
  if (page && !otherTag) {
    page.remove();
  } else {
    condition.push(selectorParser.combinator({ value: ' ' }));
  }
  // The tag goes first: a type selector can only start a compound.
  for (const node of condition.reverse()) {
    selector.prepend(node);
  }
  selector.first.spaces.before = leading;
};

const scopeProcessorFor = (scheme: ColorScheme) =>
  selectorParser((selectors) => {
    selectors.each((selector) => {
      scopeSelector(selector, scheme);
    });
  });

const SCOPE_PROCESSORS = {
  dark: scopeProcessorFor('dark'),
  light: scopeProcessorFor('light'),
};

/**
 * Whether a rule sits in `@keyframes`, whose `from`/`to` aren't selectors.
 */
const inKeyframes = (rule: Rule): boolean => {
  for (
    let node: Container | undefined = rule.parent;
    node;
    node = node.parent as Container | undefined
  ) {
    if (node.type === 'atrule' && /keyframes$/i.test((node as AtRule).name)) {
      return true;
    }
  }
  return false;
};

/**
 * Scopes every style rule in `container` (itself included, if it's a rule)
 * to `scheme`. Returns `false`, changing nothing, if a selector can't be
 * parsed, so the caller leaves the container where it was.
 */
const scopeRules = (container: Rule | AtRule, scheme: ColorScheme): boolean => {
  const rules: Rule[] = [];
  if (container.type === 'rule') {
    rules.push(container);
  } else {
    container.walkRules((rule) => {
      if (!inKeyframes(rule)) rules.push(rule);
    });
  }
  let scoped: string[];
  try {
    scoped = rules.map((rule) =>
      SCOPE_PROCESSORS[scheme].processSync(rule.selector),
    );
  } catch {
    return false;
  }
  rules.forEach((rule, index) => {
    rule.selector = scoped[index]!;
  });
  return true;
};

/**
 * Turns each `@media (prefers-color-scheme: dark)` block into rules under
 * `page.dark`, and each `(prefers-color-scheme: light)` one into rules under
 * `page:not(.dark)`: `@media (prefers-color-scheme: dark) { .card { … } }`
 * becomes `page.dark .card { … }`.
 *
 * Only style rules move out, and conditional blocks holding them (`dark:md:`
 * puts a width query inside, which stays). Anything else, such as
 * `@keyframes`, stays in the media query, where it applied before: nowhere
 * on Lynx.
 */
export const lowerColorSchemeQueries = (root: Root): void => {
  root.walkAtRules(/^media$/i, (media) => {
    const scheme = COLOR_SCHEME_QUERY.exec(media.params)?.[1]?.toLowerCase() as
      | ColorScheme
      | undefined;
    // Inside a rule, it's nesting Lynx can't read, so it's left as it is.
    if (!scheme || !media.nodes || media.parent?.type === 'rule') return;
    for (const child of media.nodes.slice()) {
      const movable =
        child.type === 'rule' ||
        (child.type === 'atrule' && /^(media|supports)$/i.test(child.name));
      if (movable && scopeRules(child, scheme)) {
        media.before(child);
      }
    }
    if (media.nodes.every((node) => node.type === 'comment')) {
      media.remove();
    }
  });
};

/**
 * A PostCSS plugin that makes `prefers-color-scheme` media queries follow
 * the app's appearance, which is what Tailwind's `dark:` variant writes.
 *
 * Lynx has no `@media`: the template encoder drops it (it only reads it
 * behind a compile option, `enable_css_rule_`), and so does Lynx for Web's,
 * so a `dark:` class and a stylesheet's own dark block never applied, on the
 * phone or in the web preview. The runtime gives `page` the `dark` class
 * while the app is drawn dark (the runtime's page-color-scheme.ts), from the
 * phone's appearance or the app's own choice, so the query becomes a
 * selector on that class, which Lynx reads.
 *
 * A descendant selector such as `page.dark .card` re-matches when the page's
 * class changes only with Lynx's `enableCSSInvalidation`, which the plugin
 * turns on by default (see utils/options.ts). Without it, the screen would
 * keep the appearance it first rendered in.
 *
 * It runs at `OnceExit`, after Tailwind 4's lowering (applyColorScheme has to
 * come after applyTailwind), which moves the queries Tailwind nests in rules
 * out to the top level, and on every environment, so the web preview follows
 * the app's appearance as the phone does, `setColorScheme()` included.
 */
export const colorSchemeForLynx: PluginCreator<void> = () => ({
  postcssPlugin: 'angular-lynx-color-scheme',
  OnceExit(root) {
    lowerColorSchemeQueries(root);
  },
});
colorSchemeForLynx.postcss = true;

/**
 * Adds `colorSchemeForLynx` to every environment's PostCSS plugins.
 */
export const applyColorScheme = (api: RsbuildPluginAPI): void => {
  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
    mergeRsbuildConfig(config, {
      tools: {
        postcss: (_options, { addPlugins }) => {
          addPlugins(colorSchemeForLynx());
        },
      },
    }),
  );
};
