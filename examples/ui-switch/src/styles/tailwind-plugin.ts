import plugin from 'tailwindcss/plugin';
import type { PluginAPI } from 'tailwindcss/types/config';

/**
 * The four physical sides, paired with their safe-area `env()` inset. Used to
 * generate the padding utilities below without repeating the mapping.
 */
const SAFE_AREA_SIDES = {
  t: { prop: 'padding-top', inset: 'env(safe-area-inset-top)' },
  r: { prop: 'padding-right', inset: 'env(safe-area-inset-right)' },
  b: { prop: 'padding-bottom', inset: 'env(safe-area-inset-bottom)' },
  l: { prop: 'padding-left', inset: 'env(safe-area-inset-left)' },
} as const;

/**
 * Registers safe-area-aware padding utilities driven by CSS `env(safe-area-inset-*)`.
 *
 * Why `env()` works on Lynx: the native CSS engine parses `env(safe-area-inset-*)`
 * as a length (see references/lynx .../css_style_utils.cc `GetEnvValue`), and its
 * calc parser accepts `env()` *inside* `calc()` too — so `calc(1rem + env(...))`
 * is valid on device. The inset values default to `0` until the native host app
 * populates them, so every utility here degrades gracefully to plain padding
 * (the offset variants) or to no padding (the bare variants).
 *
 * Two flavors:
 * - Bare (`.pb-safe`, `.px-safe`, `.p-safe`, …) — padding equal to the inset alone.
 * - Offset (`.pb-safe-4`, `.pt-safe-2`, …) — a spacing-scale value PLUS the inset,
 *   e.g. `calc(1rem + env(safe-area-inset-bottom))`. Use these when an element
 *   already wants base padding but must also clear the notch/home indicator
 *   (the toast wrapper is the canonical case).
 */
export const addSafeAreaUtilities = ({
  addUtilities,
  matchUtilities,
  theme,
}: Pick<PluginAPI, 'addUtilities' | 'matchUtilities' | 'theme'>): void => {
  const { t, r, b, l } = SAFE_AREA_SIDES;

  // Bare utilities: padding = the inset itself.
  addUtilities({
    '.pt-safe': { [t.prop]: t.inset },
    '.pr-safe': { [r.prop]: r.inset },
    '.pb-safe': { [b.prop]: b.inset },
    '.pl-safe': { [l.prop]: l.inset },
    '.px-safe': { [l.prop]: l.inset, [r.prop]: r.inset },
    '.py-safe': { [t.prop]: t.inset, [b.prop]: b.inset },
    '.p-safe': {
      [t.prop]: t.inset,
      [r.prop]: r.inset,
      [b.prop]: b.inset,
      [l.prop]: l.inset,
    },
  });

  // Offset utilities: base spacing + the inset, one family per side. Generated
  // from the theme spacing scale so `pb-safe-4`, `pt-safe-2`, etc. all exist and
  // stay in sync with the rest of the padding scale.
  const spacing = theme('spacing') as Record<string, string>;
  for (const { prop, inset } of [t, r, b, l]) {
    const side = prop.replace('padding-', '')[0]; // 't' | 'r' | 'b' | 'l'
    matchUtilities(
      {
        [`p${side}-safe`]: (value) => ({
          [prop]: `calc(${value} + ${inset})`,
        }),
      },
      { values: spacing },
    );
  }
};

/**
 * Tailwind plugin that maps @blotch/ui CSS variables to semantic color utilities
 * and registers safe-area-aware padding utilities.
 *
 * Usage in tailwind.config.ts:
 *   import { blotchPlugin } from '@blotch/ui/theme/tailwind-plugin';
 *   export default { plugins: [blotchPlugin] };
 *
 * Colors reference CSS variables DIRECTLY (`var(--x)`) rather than the shadcn/ui
 * pattern of wrapping raw HSL channels in `hsl(var(--x) / <alpha-value>)`. Lynx's
 * native CSS engine only parses comma-separated hsl(); Tailwind emits the
 * space-separated form `hsl(var(--x) / 1)`, which Lynx silently drops (colors
 * render transparent on device while looking fine in the web preview). Storing
 * complete rgba() values in the variables (see theme/default.css) and
 * referencing them directly avoids color-function parsing entirely. This matches
 * the official React Lynx Tailwind example.
 *
 * Tradeoff: Tailwind opacity modifiers on semantic colors (bg-primary/50) don't
 * work — the value is opaque with no separable channels. For the rare
 * translucent-semantic need, add a dedicated rgba() variable (see
 * `--destructive-subtle` → `destructive.subtle`) or use `opacity-*` on the element.
 *
 * Safe area: see `addSafeAreaUtilities` for the `*-safe` / `*-safe-<n>` padding
 * utilities that keep content clear of notches and home indicators.
 */
export const blotchPlugin = plugin(
  ({ addBase, addUtilities, matchUtilities, theme }) => {
    addBase({
      '*': {
        'border-color': 'var(--border)',
      },
    });
    addSafeAreaUtilities({ addUtilities, matchUtilities, theme });
  },
  {
    theme: {
      extend: {
        colors: {
          background: 'var(--background)',
          foreground: 'var(--foreground)',
          primary: {
            DEFAULT: 'var(--primary)',
            foreground: 'var(--primary-foreground)',
          },
          secondary: {
            DEFAULT: 'var(--secondary)',
            foreground: 'var(--secondary-foreground)',
          },
          muted: {
            DEFAULT: 'var(--muted)',
            foreground: 'var(--muted-foreground)',
          },
          accent: {
            DEFAULT: 'var(--accent)',
            foreground: 'var(--accent-foreground)',
          },
          destructive: {
            DEFAULT: 'var(--destructive)',
            foreground: 'var(--destructive-foreground)',
            // Pre-composed translucent red for subtle destructive backgrounds,
            // since bg-destructive/10 (opacity modifier) can't work here.
            subtle: 'var(--destructive-subtle)',
          },
          border: 'var(--border)',
          input: 'var(--input)',
          ring: 'var(--ring)',
          card: {
            DEFAULT: 'var(--card)',
            foreground: 'var(--card-foreground)',
          },
        },
        borderRadius: {
          lg: 'var(--radius)',
          md: 'calc(var(--radius) - 2px)',
          sm: 'calc(var(--radius) - 4px)',
        },
      },
    },
  },
);
