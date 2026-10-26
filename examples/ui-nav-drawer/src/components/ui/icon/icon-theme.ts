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
 * your own with {@link provideIconTheme}.
 */

/** Theme token name (without `--`) to a complete CSS color. */
export type IconColorTokens = Readonly<Record<string, string>>;

export type IconColorScheme = 'light' | 'dark';

/**
 * Which table the colors come from: a fixed scheme, `'system'` to follow the
 * device appearance (`LynxTheme`), or a function reading the app's own theme
 * state.
 *
 * It has to match how the app switches its CSS theme, since the text next to an
 * icon reads the CSS variables. The ui theme's dark mode is opt-in (the app
 * toggles the `.dark` class), so the default is `'light'`: an icon in an app
 * without dark mode stays visible when the device is dark.
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
  /** See {@link IconColorSchemeOption}; `'light'` when unset. */
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
};

export const ICON_DARK_COLORS: IconColorTokens = {
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
 * // An app that switches .dark with the device appearance:
 * providers: [provideIconTheme({ colorScheme: 'system' })]
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
 * For an SVG component's constructor: a function that resolves its `color`
 * input (or, without one, the surrounding {@link UI_ICON_COLOR}, then the
 * foreground) against the active color table. It reads signals, so a
 * `computed()` calling it follows scheme and theme changes.
 */
export const injectIconColor = (): ((color: string | undefined) => string) => {
  const theme = inject(UI_ICON_THEME);
  const appearance = inject(LynxTheme);
  const inherited = inject(UI_ICON_COLOR, { optional: true });

  const tokens = computed(() => {
    const option = theme.colorScheme ?? 'light';
    const scheme =
      option === 'system'
        ? appearance.isDarkMode()
          ? 'dark'
          : 'light'
        : typeof option === 'function'
          ? option()
          : option;
    return scheme === 'dark' ? theme.dark : theme.light;
  });

  return (color) =>
    resolveIconColor(color ?? inherited?.() ?? DEFAULT_ICON_COLOR, tokens());
};
