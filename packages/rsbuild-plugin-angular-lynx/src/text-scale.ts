import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import postcss, { type PluginCreator, type Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';

/**
 * The `page` rule that gives an app without a root font size of its own one
 * that follows the phone's text size (see the file). Only the native bundle
 * gets it, ahead of the app's own stylesheets, so an app's `page` rule wins.
 */
export const TEXT_SCALE_STYLESHEET = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './styles/text-scale.css',
);

/**
 * The `text { font-size: 1rem }` rule for an app where `font-size` doesn't
 * inherit (see the file). Only the native bundle gets it, ahead of the app's
 * own stylesheets, and only then (see entry.ts).
 */
export const TEXT_DEFAULT_SIZE_STYLESHEET = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './styles/text-default-size.css',
);

/** A plain length in px, such as `16px` or `17.5px`. */
const PX = /^(\d*\.?\d+)px$/i;

/**
 * Whether one selector matches the page itself: `page`, or `page` with
 * classes or pseudo-classes of its own, such as `page.dark`. A selector with a
 * combinator styles something inside the page, and `:root`, which Lynx also
 * matches on the page, is left to the app: Tailwind and the theme use `page`.
 *
 * A nested selector that starts with `&` (`page { &.dark { … } }`) matches the
 * page when its parent rule does: PostCSS visits its declarations before
 * Tailwind 4 flattens it into `page.dark`, at `OnceExit`, and doesn't visit
 * them again after.
 */
const isPageSelector = (
  selector: selectorParser.Selector,
  parentIsPage: boolean,
): boolean => {
  const [first, ...rest] = selector.nodes;
  const page =
    (first?.type === 'tag' && first.value.toLowerCase() === 'page') ||
    (first?.type === 'nesting' && parentIsPage);
  return (
    page &&
    rest.every((node) => node.type === 'class' || node.type === 'pseudo')
  );
};

/**
 * Splits a rule's selector list into the selectors that match the page and
 * the rest, or returns undefined for one PostCSS can't parse.
 */
const pageSelectors = (
  rule: Rule,
): { page: string[]; other: string[] } | undefined => {
  const parent = rule.parent;
  const parentIsPage =
    parent?.type === 'rule' &&
    (() => {
      const split = pageSelectors(parent as Rule);
      return !!split && split.page.length > 0 && split.other.length === 0;
    })();
  const page: string[] = [];
  const other: string[] = [];
  try {
    selectorParser((selectors) => {
      selectors.each((selector) => {
        (isPageSelector(selector, parentIsPage) ? page : other).push(
          selector.toString().trim(),
        );
      });
    }).processSync(rule.selector);
  } catch {
    return undefined;
  }
  return { page, other };
};

/**
 * A PostCSS plugin that makes the page's root font size follow the phone's
 * text size: `page { font-size: 16px }` becomes `page { font-size: 16sp }`.
 *
 * `1rem` is the page's font size in Lynx, and the root of every `rem` size:
 * Tailwind's `h-12`, `p-4` and `text-base`, and the `@blotch/ui` components,
 * which are sized in `rem` for this. Lynx scales an `sp` length by the
 * LynxView's font scale, which the shells set from Dynamic Type on iOS and the
 * font size setting on Android, and the build tells Lynx to scale nothing
 * else (`fontScaleEffectiveOnlyOnSp` in angular-webpack-plugin.ts). So the
 * root grows with the phone's text, everything in `rem` grows with it, and a
 * size in `px` stays as written, for a label that mustn't grow.
 *
 * Only a plain px length changes. A `rem`, `em` or `%` on the page is of the
 * root itself, and a `calc()` or `var()` is the app's own arithmetic. The
 * declaration's copy for the HTML text tags (text-inheritance.ts, at
 * `OnceExit`) comes after this rewrite, so it carries the `sp` too, and their
 * text grows with the page's.
 *
 * Only the native bundle takes it: a browser has no `sp`, and the web
 * preview stays at the browser's size.
 */
export const textScaleForLynx: PluginCreator<void> = () => {
  // The mixed lists that already have their page rule: PostCSS visits a
  // declaration again after the tree around it changes.
  const split = new WeakSet<object>();
  return {
    postcssPlugin: 'angular-lynx-text-scale',
    Declaration: {
      'font-size'(declaration) {
        const rule = declaration.parent;
        if (rule?.type !== 'rule' || split.has(rule)) return;
        const px = PX.exec(declaration.value.trim());
        if (!px) return;
        const selectors = pageSelectors(rule as Rule);
        if (!selectors || selectors.page.length === 0) return;
        if (selectors.other.length === 0) {
          declaration.value = `${px[1]}sp`;
          return;
        }
        // A list that also styles other elements (`page, view { font-size:
        // 16px }`) keeps its px for them: their text mustn't grow, since px
        // is the app's way to say so. The page gets a rule of its own right
        // after, which wins over the list for it, as the later of two rules
        // of the same specificity does. It takes every font-size the list
        // has, in order, so a later one (a fallback's override, a var())
        // still wins over an earlier one there.
        const pageRule = postcss.rule({ selector: selectors.page.join(', ') });
        (rule as Rule).walkDecls(/^font-size$/i, (fontSize) => {
          if (fontSize.parent !== rule) return;
          const match = PX.exec(fontSize.value.trim());
          pageRule.append(
            fontSize.clone(match ? { value: `${match[1]}sp` } : {}),
          );
        });
        (rule as Rule).after(pageRule);
        split.add(rule);
      },
    },
  };
};
textScaleForLynx.postcss = true;

/**
 * Adds `textScaleForLynx` to the native environment's PostCSS plugins.
 */
export const applyTextScale = (api: RsbuildPluginAPI): void => {
  api.modifyEnvironmentConfig((config, { name, mergeEnvironmentConfig }) =>
    name === 'lynx'
      ? mergeEnvironmentConfig(config, {
          tools: {
            postcss: (_options, { addPlugins }) => {
              addPlugins(textScaleForLynx());
            },
          },
        })
      : config,
  );
};
