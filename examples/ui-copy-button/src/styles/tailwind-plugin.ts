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
 * as a length (see lynx-family/lynx's css_style_utils.cc `GetEnvValue`), and its
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
 * What Tailwind passes a color it was given as a function:
 * - an opacity modifier sets only `opacityValue` (`bg-primary/50` → `0.5`);
 * - a plain class whose utility has an opacity variable sets
 *   `opacityVariable` too, and `opacityValue` is `var(--tw-bg-opacity, 1)`
 *   (`bg-primary`);
 * - other plain classes pass neither (`caret-primary`);
 * - `theme('colors.primary')` in a stylesheet passes an `opacityValue` of 1.
 */
type ColorOptions = {
  opacityValue?: string | number;
  opacityVariable?: string;
};

/**
 * A theme color that takes Tailwind's opacity modifiers on Lynx.
 *
 * A plain class reads the complete color, as it always has:
 * `bg-primary` → `background-color: var(--primary)`. A modifier reads the
 * color's channels from its `-rgb` twin:
 * `bg-primary/50` → `background-color: rgba(var(--primary-rgb), 0.5)`.
 *
 * Lynx substitutes `var()` as text before it parses the value, so with
 * `--primary-rgb: 24, 24, 27` its color parser sees `rgba(24, 24, 27, 0.5)`
 * (`CSSValue::Substitution` in lynx-family/lynx). The channels are
 * comma-separated because every Lynx color parser takes `rgba()` in that
 * form. Lynx takes `hsl()` only with commas, which is why the shadcn/ui form,
 * `hsl(var(--x) / 0.5)`, draws nothing.
 *
 * Plain classes stay on `var(--x)` so they don't need the channels: with a
 * theme copied before the `-rgb` variables existed, every plain class still
 * draws, and only modifiers don't. Tailwind's `<alpha-value>` placeholder
 * can't do that, as it puts the channels in plain classes too. An alpha of 1
 * is the plain color, so `bg-primary/100` and `theme('colors.primary')` read
 * `var(--primary)` as well.
 */
export const themeColor =
  (name: string) =>
  ({ opacityValue, opacityVariable }: ColorOptions = {}): string =>
    opacityValue === undefined ||
    opacityVariable !== undefined ||
    String(opacityValue) === '1'
      ? `var(--${name})`
      : `rgba(var(--${name}-rgb), ${opacityValue})`;

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
 * Opacity modifiers (`bg-primary/50`, `text-foreground/70`,
 * `border-border/60`) read each color's `--x-rgb` channels instead; see
 * `themeColor`.
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
        // Tailwind's types only allow strings here, but it also takes a
        // function, which it calls with the modifier's alpha: that's how it
        // applies `<alpha-value>` itself. Every color but destructive.subtle
        // and glass.dim, which are translucent already, has an `--x-rgb` twin
        // in the theme, so takes opacity modifiers.
        colors: {
          background: themeColor('background'),
          foreground: themeColor('foreground'),
          primary: {
            DEFAULT: themeColor('primary'),
            foreground: themeColor('primary-foreground'),
          },
          secondary: {
            DEFAULT: themeColor('secondary'),
            foreground: themeColor('secondary-foreground'),
          },
          muted: {
            DEFAULT: themeColor('muted'),
            foreground: themeColor('muted-foreground'),
          },
          accent: {
            DEFAULT: themeColor('accent'),
            foreground: themeColor('accent-foreground'),
          },
          destructive: {
            DEFAULT: themeColor('destructive'),
            foreground: themeColor('destructive-foreground'),
            // Red at 10%, the destructive alert's background. It's
            // translucent already, so it has no channels and takes no
            // modifier. It predates modifiers and stays for the apps that
            // use it: bg-destructive/10 draws the same color, but only in a
            // theme that has --destructive-rgb.
            subtle: 'var(--destructive-subtle)',
          },
          border: themeColor('border'),
          input: themeColor('input'),
          ring: themeColor('ring'),
          card: {
            DEFAULT: themeColor('card'),
            foreground: themeColor('card-foreground'),
          },
          // Chart series colors, e.g. bg-chart-1 for a legend swatch that
          // matches the first series.
          chart: {
            1: themeColor('chart-1'),
            2: themeColor('chart-2'),
            3: themeColor('chart-3'),
            4: themeColor('chart-4'),
            5: themeColor('chart-5'),
          },
          // What sits on Liquid Glass, and its tint: text-glass-foreground,
          // bg-glass-tint, bg-glass-dim (see the glass component).
          glass: {
            tint: {
              DEFAULT: themeColor('glass-tint'),
              foreground: themeColor('glass-tint-foreground'),
            },
            foreground: themeColor('glass-foreground'),
            'muted-foreground': themeColor('glass-muted-foreground'),
            'clear-foreground': themeColor('glass-clear-foreground'),
            dim: 'var(--glass-dim)',
          },
        } as unknown as Record<string, string>,
        borderRadius: {
          lg: 'var(--radius)',
          md: 'calc(var(--radius) - 2px)',
          sm: 'calc(var(--radius) - 4px)',
        },
      },
    },
  },
);
