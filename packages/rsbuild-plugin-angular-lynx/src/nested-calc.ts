import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { PluginCreator } from 'postcss';
import valueParser, { type Node } from 'postcss-value-parser';

/** Two `calc(`s in one value, so one may be inside the other. */
const TWO_CALCS = /calc\([\s\S]*calc\(/i;

/**
 * `value` with each `calc()` inside another `calc()` written as plain
 * parentheses, or `undefined` if it has none: `calc(calc(var(--spacing) * 3)
 * + 1px)` becomes `calc((var(--spacing) * 3) + 1px)`, which means the same.
 *
 * A `calc()` inside a `var()`'s fallback counts when the `var()` is inside a
 * `calc()`, since Lynx substitutes the fallback there as text.
 */
export const flattenNestedCalc = (value: string): string | undefined => {
  if (!TWO_CALCS.test(value)) return undefined;
  const parsed = valueParser(value);
  let changed = false;
  const flatten = (nodes: Node[], inCalc: boolean): void => {
    for (const node of nodes) {
      if (node.type !== 'function') continue;
      const isCalc = node.value.toLowerCase() === 'calc';
      if (isCalc && inCalc) {
        // valueParser writes a function without a name as a bare group.
        node.value = '';
        changed = true;
      }
      flatten(node.nodes, inCalc || isCalc);
    }
  };
  flatten(parsed.nodes, false);
  return changed ? parsed.toString() : undefined;
};

/**
 * A PostCSS plugin that writes each `calc()` nested in another `calc()` as
 * parentheses, which Lynx reads.
 *
 * Lynx drops a length whose `calc()` has a `calc()` inside it, and the
 * property falls back as if it weren't set: its evaluator
 * (`TryMakeCalcNLength` in Lynx core's renderer/css/css_style_utils.cc) skips
 * the outer `calc` and reads the rest term by term, so it takes the inner
 * `calc` for a length, which it isn't. Parentheses it reads as a group.
 * Tailwind 4 nests them as a matter of course: `--spacing(3)` is
 * `calc(var(--spacing) * 3)`, so the @blotch/ui theme's `pt-safe-3`, written
 * `calc(--spacing(3) + env(safe-area-inset-top))`, reached Lynx as
 * `calc(calc(var(--spacing) * 3) + …)` and padded nothing, not even the
 * spacing. A production build hid it, because the CSS minifier flattens nested
 * `calc()`s, so it only showed in development builds and `ng serve`.
 *
 * It applies to every stylesheet, as displayForLynx does, custom properties
 * included: Lynx substitutes a `var()` as text, so a nested `calc()` in a
 * variable's value is nested wherever the variable is read. It runs at
 * `OnceExit` to see what Tailwind 4's lowering writes there too
 * (applyNestedCalc has to come after applyTailwind). Browsers read the
 * parentheses the same, so the web preview is unchanged.
 */
export const nestedCalcForLynx: PluginCreator<void> = () => ({
  postcssPlugin: 'angular-lynx-nested-calc',
  OnceExit(root) {
    root.walkDecls((declaration) => {
      const value = flattenNestedCalc(declaration.value);
      if (value !== undefined) declaration.value = value;
    });
  },
});
nestedCalcForLynx.postcss = true;

/**
 * Adds `nestedCalcForLynx` to every environment's PostCSS plugins. Call it
 * after applyTailwind, so it runs after Tailwind 4's lowering at OnceExit.
 */
export const applyNestedCalc = (api: RsbuildPluginAPI): void => {
  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
    mergeRsbuildConfig(config, {
      tools: {
        postcss: (_options, { addPlugins }) => {
          addPlugins(nestedCalcForLynx());
        },
      },
    }),
  );
};
