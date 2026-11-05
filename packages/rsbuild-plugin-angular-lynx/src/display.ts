import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { PluginCreator } from 'postcss';

/**
 * The `display` values the web lays out and Lynx doesn't, each with the Lynx
 * value that lays its children out the way the web value does. A copy of
 * `LYNX_DISPLAY` in the runtime's lynx-element/display.ts, which rewrites
 * inline styles and which this package can't import (it runs in Node, the
 * runtime in Lynx), kept the same by a test.
 */
export const LYNX_DISPLAY: ReadonlyMap<string, string> = new Map([
  ['block', 'linear'],
  ['flow-root', 'linear'],
  ['inline', 'linear'],
  ['inline-block', 'linear'],
  ['inline-flex', 'flex'],
  ['inline-grid', 'grid'],
]);

/**
 * A PostCSS plugin that makes `display` lay out as it does on the web.
 *
 * Lynx takes `display: block` but has no block layout: it lays the element
 * out as `flex`, a row, so a child that doesn't set its width shrinks to its
 * content (`GetDisplay` in Lynx core's starlight/style/
 * layout_computed_style.cc). `:host { display: block }` is how a web component
 * says it isn't inline, so most Angular components that size themselves carry
 * it, and so does a component `ng generate component --display-block` makes.
 * Lynx's `linear`, vertical, stacks the children and stretches each across
 * the container, as a block does, and it's what an element that sets no
 * `display` gets (`defaultDisplayLinear`).
 *
 * Lynx has no inline layout for elements other than text, and drops the
 * inline values. Each becomes the value that lays the element's own children
 * out as the web does, so `inline-flex` keeps its row.
 *
 * It applies to every stylesheet: component styles (a library's as well as
 * the app's, after Angular scoped them) and global ones. Lynx for Web passes
 * `display: block` to the browser, which lays it out as a block, so rewriting
 * it in the web environment too keeps the web preview the same as the app.
 *
 * It rewrites each declaration as PostCSS visits it, which is after Tailwind
 * wrote its utilities (Tailwind 3 runs on the whole stylesheet, and Tailwind
 * 4 in `Once`) and before Tailwind 4's lowering, at `OnceExit`, drops the
 * values Lynx lacks: `inline-flex` becomes `flex` rather than nothing.
 */
export const displayForLynx: PluginCreator<void> = () => ({
  postcssPlugin: 'angular-lynx-display',
  Declaration: {
    display(declaration) {
      const lynx = LYNX_DISPLAY.get(declaration.value.trim().toLowerCase());
      if (lynx) declaration.value = lynx;
    },
  },
});
displayForLynx.postcss = true;

/**
 * Adds `displayForLynx` to every environment's PostCSS plugins.
 */
export const applyDisplay = (api: RsbuildPluginAPI): void => {
  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
    mergeRsbuildConfig(config, {
      tools: {
        postcss: (_options, { addPlugins }) => {
          addPlugins(displayForLynx());
        },
      },
    }),
  );
};
