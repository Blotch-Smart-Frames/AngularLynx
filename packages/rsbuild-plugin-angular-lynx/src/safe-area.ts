import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { PluginCreator } from 'postcss';
import valueParser, { type Node } from 'postcss-value-parser';

/**
 * The CSS variable that carries each safe-area inset to the stylesheets in an
 * app the native builder generated. A copy of `SAFE_AREA_INSET_VARIABLES` in
 * the runtime's lynx-element/safe-area-insets.ts, which sets the variables on
 * the page and explains why; this package can't import it (it runs in Node,
 * the runtime in Lynx), so a test keeps the two the same.
 */
export const SAFE_AREA_INSET_VARIABLES: Readonly<Record<string, string>> = {
  top: '--angular-lynx-safe-area-inset-top',
  right: '--angular-lynx-safe-area-inset-right',
  bottom: '--angular-lynx-safe-area-inset-bottom',
  left: '--angular-lynx-safe-area-inset-left',
};

const OURS = new Set(Object.values(SAFE_AREA_INSET_VARIABLES));

/**
 * The side an `env(safe-area-inset-<side>)` reads, or `undefined` for any
 * other node.
 */
const insetSide = (node: Node): string | undefined => {
  if (node.type !== 'function' || node.value.toLowerCase() !== 'env') {
    return undefined;
  }
  const name = node.nodes.find((child) => child.type === 'word');
  const side = /^safe-area-inset-(top|right|bottom|left)$/i.exec(
    name?.value ?? '',
  )?.[1];
  return side?.toLowerCase();
};

/**
 * `value` with each `env(safe-area-inset-*)` reading the shell's inset
 * first, or `undefined` if it has none.
 */
const withSafeAreaInsets = (value: string): string | undefined => {
  const parsed = valueParser(value);
  let changed = false;
  parsed.walk((node) => {
    // A value this plugin already wrote: PostCSS visits a declaration again
    // after a plugin changes it, and the env() in the fallback mustn't be
    // wrapped a second time (Lynx rejects a var() in a var()'s fallback).
    if (
      node.type === 'function' &&
      node.value.toLowerCase() === 'var' &&
      OURS.has(node.nodes[0]?.value ?? '')
    ) {
      return false;
    }
    const side = insetSide(node);
    if (!side) return undefined;
    // Lynx reads no env() fallback (it looks the whole argument up as the
    // name), and browsers always define the insets, so it's dropped.
    Object.assign(node, {
      type: 'word',
      value: `var(${SAFE_AREA_INSET_VARIABLES[side]}, env(safe-area-inset-${side}))`,
    });
    changed = true;
    return false;
  });
  return changed ? parsed.toString() : undefined;
};

/**
 * A PostCSS plugin that makes each `env(safe-area-inset-*)` read the insets a
 * generated app's shell sends: `padding-top: env(safe-area-inset-top)`
 * becomes `padding-top: var(--angular-lynx-safe-area-inset-top,
 * env(safe-area-inset-top))`.
 *
 * Apps from `ng build --platform ios|android` draw the page edge to edge, and
 * the runtime sets the variables on the page from the insets the shell sends,
 * because Lynx's own `env()` is 0 there and can't follow a rotation (see the
 * runtime's safe-area-insets.ts, which gives inline styles the insets
 * itself). Elsewhere nothing sets them, and the `var()` falls back to the
 * `env()` it replaced: Lynx Explorer's insets, and the browser's in the web
 * preview. In a stylesheet Lynx resolves a `var()` inside a `calc()` too, as
 * in the theme's `pb-safe-4`.
 *
 * It applies to every stylesheet, as displayForLynx does: component styles
 * (a library's as well as the app's) and global ones, including the theme's
 * `pt-safe` utilities. A custom property's value is left as it is, because
 * Lynx never resolves a `var()` inside a function inside one
 * (`--pad: calc(var(--x) + 8px)`), so the rewrite would break
 * `--pad: calc(env(safe-area-inset-top) + 8px)`, which Lynx Explorer reads.
 */
export const safeAreaForLynx: PluginCreator<void> = () => ({
  postcssPlugin: 'angular-lynx-safe-area',
  Declaration(declaration) {
    if (
      declaration.prop.startsWith('--') ||
      !/env\(/i.test(declaration.value)
    ) {
      return;
    }
    const value = withSafeAreaInsets(declaration.value);
    if (value !== undefined) declaration.value = value;
  },
});
safeAreaForLynx.postcss = true;

/**
 * Adds `safeAreaForLynx` to every environment's PostCSS plugins.
 */
export const applySafeArea = (api: RsbuildPluginAPI): void => {
  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
    mergeRsbuildConfig(config, {
      tools: {
        postcss: (_options, { addPlugins }) => {
          addPlugins(safeAreaForLynx());
        },
      },
    }),
  );
};
