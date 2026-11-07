import { InjectionToken, type Provider } from '@angular/core';
import type { ChartTheme } from '@tanstack/charts/types';

/**
 * Theme for `<ui-chart>`.
 *
 * ## Why colors live in TypeScript as well as CSS
 * A chart's marks are drawn by Lynx's native `<svg>` element, which parses an
 * SVG string by itself: it never sees the page's CSS, so `var(--primary)` means
 * nothing to it, and Lynx has no computed-style API to read the variable's value
 * from JS. So the scene keeps CSS-shaped paints (`var(--primary)`, the palette's
 * `var(--chart-1)`), and the chart swaps each for the value in the active color
 * table below just before it writes the SVG.
 *
 * The tables mirror `default.css` and `dark.css` (a test in the theme folder
 * keeps them in step). If you change a color there, change it here too, or pass
 * your own with {@link provideChartTheme}. Axis labels are native `<text>`, so
 * they read the CSS variables directly and always match the page.
 */

/** Theme token name (without `--`) to a complete CSS color. */
export type ChartColorTokens = Readonly<Record<string, string>>;

export type ChartColorScheme = 'light' | 'dark';

/**
 * Which colors a chart draws with: a fixed scheme, `'system'` to follow the
 * device appearance (`LynxTheme`), or a function reading the app's own theme
 * state.
 *
 * It has to match how the app switches its CSS theme, because axis labels use
 * the CSS variables while the marks use the tables below. The ui theme's dark
 * mode is opt-in (the app toggles the `.dark` class), so the default is
 * `'light'`: a chart in an app without dark mode stays readable when the
 * device is dark. An app that toggles `.dark` from `LynxTheme` (see the dark
 * mode guide) uses `'system'`.
 */
export type ChartColorSchemeOption =
  | ChartColorScheme
  | 'system'
  | (() => ChartColorScheme);

export type UiChartTheme = {
  /** Token values for light mode; mirrors `default.css`. */
  readonly light: ChartColorTokens;
  /** Token values for dark mode; mirrors `dark.css`. */
  readonly dark: ChartColorTokens;
  /** See {@link ChartColorSchemeOption}; `'light'` when unset. */
  readonly colorScheme?: ChartColorSchemeOption;
  /**
   * The theme TanStack Charts builds scenes with. Its paints should be
   * `var(--token)` strings, so one scene serves both color schemes.
   */
  readonly chart: Partial<ChartTheme>;
};

export const CHART_LIGHT_COLORS: ChartColorTokens = {
  background: 'rgba(255, 255, 255, 1)',
  foreground: 'rgba(9, 9, 11, 1)',
  card: 'rgba(255, 255, 255, 1)',
  'card-foreground': 'rgba(9, 9, 11, 1)',
  primary: 'rgba(24, 24, 27, 1)',
  'primary-foreground': 'rgba(250, 250, 250, 1)',
  secondary: 'rgba(244, 244, 245, 1)',
  'secondary-foreground': 'rgba(24, 24, 27, 1)',
  muted: 'rgba(244, 244, 245, 1)',
  'muted-foreground': 'rgba(113, 113, 122, 1)',
  accent: 'rgba(244, 244, 245, 1)',
  'accent-foreground': 'rgba(24, 24, 27, 1)',
  destructive: 'rgba(239, 68, 68, 1)',
  'destructive-foreground': 'rgba(250, 250, 250, 1)',
  'destructive-subtle': 'rgba(239, 68, 68, 0.1)',
  border: 'rgba(228, 228, 231, 1)',
  input: 'rgba(228, 228, 231, 1)',
  ring: 'rgba(24, 24, 27, 1)',
  'ring-subtle': 'rgba(24, 24, 27, 0.4)',
  'chart-1': 'rgba(231, 110, 80, 1)',
  'chart-2': 'rgba(42, 157, 144, 1)',
  'chart-3': 'rgba(39, 71, 84, 1)',
  'chart-4': 'rgba(232, 196, 104, 1)',
  'chart-5': 'rgba(244, 164, 98, 1)',
  'glass-tint': 'rgba(24, 24, 27, 1)',
  'glass-tint-foreground': 'rgba(250, 250, 250, 1)',
  'glass-foreground': 'rgba(9, 9, 11, 1)',
  'glass-muted-foreground': 'rgba(63, 63, 70, 1)',
  'glass-clear-foreground': 'rgba(255, 255, 255, 1)',
  'glass-dim': 'rgba(0, 0, 0, 0.35)',
};

export const CHART_DARK_COLORS: ChartColorTokens = {
  background: 'rgba(9, 9, 11, 1)',
  foreground: 'rgba(250, 250, 250, 1)',
  card: 'rgba(9, 9, 11, 1)',
  'card-foreground': 'rgba(250, 250, 250, 1)',
  primary: 'rgba(250, 250, 250, 1)',
  'primary-foreground': 'rgba(24, 24, 27, 1)',
  secondary: 'rgba(39, 39, 42, 1)',
  'secondary-foreground': 'rgba(250, 250, 250, 1)',
  muted: 'rgba(39, 39, 42, 1)',
  'muted-foreground': 'rgba(161, 161, 170, 1)',
  accent: 'rgba(39, 39, 42, 1)',
  'accent-foreground': 'rgba(250, 250, 250, 1)',
  destructive: 'rgba(127, 29, 29, 1)',
  'destructive-foreground': 'rgba(250, 250, 250, 1)',
  'destructive-subtle': 'rgba(127, 29, 29, 0.1)',
  border: 'rgba(39, 39, 42, 1)',
  input: 'rgba(39, 39, 42, 1)',
  ring: 'rgba(212, 212, 216, 1)',
  'ring-subtle': 'rgba(212, 212, 216, 0.4)',
  'chart-1': 'rgba(38, 98, 217, 1)',
  'chart-2': 'rgba(46, 184, 138, 1)',
  'chart-3': 'rgba(232, 140, 48, 1)',
  'chart-4': 'rgba(175, 87, 219, 1)',
  'chart-5': 'rgba(226, 54, 112, 1)',
  'glass-tint': 'rgba(250, 250, 250, 1)',
  'glass-tint-foreground': 'rgba(24, 24, 27, 1)',
  'glass-foreground': 'rgba(250, 250, 250, 1)',
  'glass-muted-foreground': 'rgba(212, 212, 216, 1)',
  'glass-clear-foreground': 'rgba(255, 255, 255, 1)',
  'glass-dim': 'rgba(0, 0, 0, 0.35)',
};

/**
 * TanStack's own defaults paint everything `currentColor` at reduced opacity
 * (grid lines at 0.11, tick labels at 0.72), which reads well on any background.
 * The same roles map onto theme tokens: text and grid follow the foreground,
 * secondary text the muted foreground, and series cycle through `--chart-*`.
 */
export const DEFAULT_CHART_THEME: Partial<ChartTheme> = {
  foreground: 'var(--foreground)',
  muted: 'var(--muted-foreground)',
  grid: 'var(--foreground)',
  background: 'transparent',
  palette: [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
  ],
};

export const UI_CHART_THEME = new InjectionToken<UiChartTheme>(
  'UI_CHART_THEME',
  {
    providedIn: 'root',
    factory: () => ({
      light: CHART_LIGHT_COLORS,
      dark: CHART_DARK_COLORS,
      chart: DEFAULT_CHART_THEME,
    }),
  },
);

/**
 * Overrides chart colors, merged over the defaults: pass only the tokens you
 * changed in your theme CSS, or a different TanStack theme (e.g. a palette).
 *
 * ```ts
 * providers: [provideChartTheme({ light: { 'chart-1': 'rgba(37, 99, 235, 1)' } })]
 * // An app that switches .dark with the device appearance:
 * providers: [provideChartTheme({ colorScheme: 'system' })]
 * ```
 */
export const provideChartTheme = (theme: {
  light?: ChartColorTokens;
  dark?: ChartColorTokens;
  chart?: Partial<ChartTheme>;
  colorScheme?: ChartColorSchemeOption;
}): Provider => ({
  provide: UI_CHART_THEME,
  useValue: {
    light: { ...CHART_LIGHT_COLORS, ...theme.light },
    dark: { ...CHART_DARK_COLORS, ...theme.dark },
    chart: { ...DEFAULT_CHART_THEME, ...theme.chart },
    colorScheme: theme.colorScheme,
  } satisfies UiChartTheme,
});

/**
 * Turns a CSS-shaped paint into a concrete color an SVG parser can draw:
 * `var(--token)` (with or without a fallback) becomes the token's value,
 * `currentColor` the foreground. Anything else (`#2563eb`, `rgba(…)`, a
 * gradient's `url(#id)`) is already concrete and passes through.
 */
export const resolveChartPaint = (
  paint: string,
  colors: ChartColorTokens,
): string => {
  const value = paint.trim();
  if (value === 'currentColor' || value === 'CanvasText') {
    return colors['foreground'] ?? value;
  }
  if (value === 'Canvas') return colors['background'] ?? value;
  if (!value.startsWith('var(') || !value.endsWith(')')) return value;

  const inner = value.slice(4, -1);
  // A custom property name can't contain a comma or parenthesis, so the first
  // comma always separates the name from the fallback.
  const comma = inner.indexOf(',');
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  const token = colors[name.replace(/^--/, '')];
  if (token !== undefined) return token;
  // An unknown token falls back the way CSS does: to the var()'s fallback when
  // it has one (TanStack's own palette is `var(--ts-chart-1, #2563eb)`), and
  // otherwise to the foreground so the mark stays visible.
  return comma < 0
    ? (colors['foreground'] ?? value)
    : resolveChartPaint(inner.slice(comma + 1), colors);
};
