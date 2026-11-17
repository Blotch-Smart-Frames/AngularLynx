import {
  computed,
  inject,
  InjectionToken,
  type Provider,
  type Signal,
} from '@angular/core';
import { LynxTheme } from '@blotch/angular-lynx';

/**
 * Colors for the components that draw with Lynx's `<svg>`: `<ui-icon>`,
 * `<ui-spinner>`, and the parts built on them (pagination's chevrons, a loading
 * button's spinner).
 *
 * ## Why colors live in TypeScript as well as CSS
 * `<svg>` parses its markup by itself. It never sees the page's CSS: on the web
 * preview the markup becomes an `<img>`, and the native elements in Lynx 4.1
 * read only a literal `current-color`. So `var(--foreground)` and text color
 * classes can't reach a stroke, and Lynx has no computed-style API to read a
 * variable's value from JS. Instead these components take `var(--token)` colors
 * and swap each for its value in the active table below before they write the
 * markup. This mirrors how `<ui-chart>` colors its marks (`chart-theme.ts`).
 *
 * The tables mirror `default.css` and `dark.css` (a test in the theme folder
 * keeps them in step). If you change a color there, change it here too, or pass
 * your own with {@link provideIconTheme}. Colors set at runtime, such as
 * Android's wallpaper colors, come from an element above instead (see
 * {@link UI_THEME_COLORS}).
 */

/** Theme token name (without `--`) to a complete CSS color. */
export type IconColorTokens = Readonly<Record<string, string>>;

export type IconColorScheme = 'light' | 'dark';

/**
 * Which table the colors come from: `'system'` to follow the appearance the
 * app is drawn in (`LynxTheme.appearance`: the device's, or the app's own
 * choice), a fixed scheme, or a function reading the app's own theme state.
 *
 * It has to match the CSS theme, since the text next to an icon reads the
 * CSS variables. The page has the theme's `dark` class while the app is
 * drawn dark, so the default is `'system'`. An app that leaves `dark.css`
 * out keeps to light with `provideColorScheme('light')`, and one that
 * switches a class of its own passes the function.
 */
export type IconColorSchemeOption =
  | IconColorScheme
  | 'system'
  | (() => IconColorScheme);

export type UiIconTheme = {
  /** Token values for light mode; mirrors `default.css`. */
  readonly light: IconColorTokens;
  /** Token values for dark mode; mirrors `dark.css`. */
  readonly dark: IconColorTokens;
  /** See {@link IconColorSchemeOption}; `'system'` when unset. */
  readonly colorScheme?: IconColorSchemeOption;
};

export const ICON_LIGHT_COLORS: IconColorTokens = {
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
  destructive: 'rgba(220, 38, 38, 1)',
  'destructive-foreground': 'rgba(250, 250, 250, 1)',
  'destructive-subtle': 'rgba(220, 38, 38, 0.08)',
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

export const ICON_DARK_COLORS: IconColorTokens = {
  background: 'rgba(9, 9, 11, 1)',
  foreground: 'rgba(250, 250, 250, 1)',
  card: 'rgba(24, 24, 27, 1)',
  'card-foreground': 'rgba(250, 250, 250, 1)',
  primary: 'rgba(250, 250, 250, 1)',
  'primary-foreground': 'rgba(24, 24, 27, 1)',
  secondary: 'rgba(39, 39, 42, 1)',
  'secondary-foreground': 'rgba(250, 250, 250, 1)',
  muted: 'rgba(39, 39, 42, 1)',
  'muted-foreground': 'rgba(161, 161, 170, 1)',
  accent: 'rgba(39, 39, 42, 1)',
  'accent-foreground': 'rgba(250, 250, 250, 1)',
  destructive: 'rgba(248, 113, 113, 1)',
  'destructive-foreground': 'rgba(24, 24, 27, 1)',
  'destructive-subtle': 'rgba(248, 113, 113, 0.14)',
  border: 'rgba(52, 52, 56, 1)',
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

export const UI_ICON_THEME = new InjectionToken<UiIconTheme>('UI_ICON_THEME', {
  providedIn: 'root',
  factory: () => ({ light: ICON_LIGHT_COLORS, dark: ICON_DARK_COLORS }),
});

/**
 * Overrides icon colors, merged over the defaults: pass only the tokens you
 * changed in your CSS, or just a color scheme.
 *
 * ```ts
 * // An app whose brand color isn't the theme's:
 * providers: [provideIconTheme({ light: { primary: 'rgba(37, 99, 235, 1)' } })]
 * ```
 */
export const provideIconTheme = (theme: {
  light?: IconColorTokens;
  dark?: IconColorTokens;
  colorScheme?: IconColorSchemeOption;
}): Provider => ({
  provide: UI_ICON_THEME,
  useValue: {
    light: { ...ICON_LIGHT_COLORS, ...theme.light },
    dark: { ...ICON_DARK_COLORS, ...theme.dark },
    colorScheme: theme.colorScheme,
  } satisfies UiIconTheme,
});

/**
 * The color icons inside an element use when they're given none. A container
 * whose variant recolors its content (a destructive nav drawer item) provides
 * it, and every `<ui-icon>` projected into it picks it up through DI, the way
 * text would inherit `color` on the web.
 */
export const UI_ICON_COLOR = new InjectionToken<Signal<string | undefined>>(
  'UI_ICON_COLOR',
);

/** An icon's size, by name: 16, 20, 24 and 32px. */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * The size icons inside an element take when they're given none. A container
 * whose own size sets its content's provides it, as a button does: a 24px
 * icon crowds a small button's label and floats in a large one's, so each
 * button size has an icon size, and the app doesn't have to know it.
 */
export const UI_ICON_SIZE = new InjectionToken<Signal<IconSize | undefined>>(
  'UI_ICON_SIZE',
);

/** What an icon draws with when nothing sets its color. */
export const DEFAULT_ICON_COLOR = 'var(--foreground)';

/**
 * Turns a color into one an SVG parser can draw: `var(--token)` (with or
 * without a fallback) becomes the token's value. Anything else (`#2563eb`,
 * `rgba(…)`) is already concrete and passes through.
 */
export const resolveIconColor = (
  color: string,
  tokens: IconColorTokens,
): string => {
  const value = color.trim();
  if (!value.startsWith('var(') || !value.endsWith(')')) return value;

  const inner = value.slice(4, -1);
  // A custom property name can't contain a comma, so the first comma always
  // separates the name from the fallback.
  const comma = inner.indexOf(',');
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  const token = tokens[name.replace(/^--/, '')];
  if (token !== undefined) return token;
  // An unknown token falls back the way CSS does: to the var()'s fallback when
  // it has one, and otherwise to the foreground so the icon stays visible.
  return comma < 0
    ? (tokens['foreground'] ?? value)
    : resolveIconColor(inner.slice(comma + 1), tokens);
};

/**
 * The color scheme the app's theme is in: the appearance the app is drawn in
 * (`LynxTheme.appearance`), unless {@link provideIconTheme} says otherwise.
 * For what has to match the app's CSS theme but can't read it: icons pick
 * their color table with it, and glass picks a light or dark material.
 */
export const injectColorScheme = (): Signal<IconColorScheme> => {
  const option = inject(UI_ICON_THEME).colorScheme ?? 'system';
  const theme = inject(LynxTheme);
  return computed(() =>
    option === 'system'
      ? theme.appearance()
      : typeof option === 'function'
        ? option()
        : option,
  );
};

/** Theme colors for each scheme, each a complete CSS color, as in the tables. */
export type ThemeColors = {
  readonly light?: IconColorTokens;
  readonly dark?: IconColorTokens;
};

/**
 * Theme colors that replace the tables' for everything inside an element,
 * as a signal: an element that sets the theme's CSS variables at runtime
 * provides the values it sets, since SVGs and native attributes can't read
 * them. `UiDynamicColor` provides Android's wallpaper colors this way. Icons,
 * glass tints and charts inside it resolve their tokens against them.
 */
export const UI_THEME_COLORS = new InjectionToken<Signal<ThemeColors>>(
  'UI_THEME_COLORS',
);

/**
 * The color table for the app's color scheme, for a component's constructor:
 * the theme's copy, with what an element above sets in its place (see
 * {@link UI_THEME_COLORS}). A signal, so it follows scheme and theme changes.
 */
export const injectThemeColors = (): Signal<IconColorTokens> => {
  const theme = inject(UI_ICON_THEME);
  const scheme = injectColorScheme();
  const replaced = inject(UI_THEME_COLORS, { optional: true });

  return computed(() => {
    const active = scheme();
    const colors = replaced?.()[active];
    return colors ? { ...theme[active], ...colors } : theme[active];
  });
};

/**
 * For an SVG component's constructor: a function that resolves its `color`
 * input (or, without one, the surrounding {@link UI_ICON_COLOR}, then the
 * foreground) against the active color table. It reads signals, so a
 * `computed()` calling it follows scheme and theme changes.
 */
export const injectIconColor = (): ((color: string | undefined) => string) => {
  const tokens = injectThemeColors();
  const inherited = inject(UI_ICON_COLOR, { optional: true });

  return (color) =>
    resolveIconColor(color ?? inherited?.() ?? DEFAULT_ICON_COLOR, tokens());
};
