import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { PluginCreator, Rule } from 'postcss';
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

/** A plain length in px, such as `16px` or `17.5px`. */
const PX = /^(\d*\.?\d+)px$/i;

/**
 * Whether one selector of a rule matches the page itself: `page`, or `page`
 * with classes or pseudo-classes of its own, such as `page.dark`. A selector
 * with a combinator styles something inside the page, and `:root`, which Lynx
 * also matches on the page, is left to the app: Tailwind and the theme use
 * `page`.
 */
const isPageSelector = (selector: selectorParser.Selector): boolean => {
  const nodes = selector.nodes;
  const tag = nodes[0];
  return (
    tag?.type === 'tag' &&
    tag.value.toLowerCase() === 'page' &&
    nodes
      .slice(1)
      .every((node) => node.type === 'class' || node.type === 'pseudo')
  );
};

/**
 * Whether every selector in a rule's list matches the page. A list that also
 * styles other elements (`page, view { font-size: 16px }`) keeps its px: a
 * view's own text must not grow twice, once through `sp` and once through
 * the root.
 */
const stylesOnlyThePage = (rule: Rule): boolean => {
  let only = true;
  try {
    selectorParser((selectors) => {
      selectors.each((selector) => {
        if (!isPageSelector(selector)) only = false;
      });
    }).processSync(rule.selector);
  } catch {
    return false;
  }
  return only;
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
export const textScaleForLynx: PluginCreator<void> = () => ({
  postcssPlugin: 'angular-lynx-text-scale',
  Declaration: {
    'font-size'(declaration) {
      const px = PX.exec(declaration.value.trim());
      const parent = declaration.parent;
      if (!px || parent?.type !== 'rule') return;
      if (!stylesOnlyThePage(parent as Rule)) return;
      declaration.value = `${px[1]}sp`;
    },
  },
});
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
