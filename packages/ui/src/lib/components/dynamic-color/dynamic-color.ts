import { computed, Directive, inject } from '@angular/core';
import {
  LynxTheme,
  type DynamicColorRole,
  type DynamicColorScheme,
} from '@blotch/angular-lynx';

import {
  injectColorScheme,
  UI_THEME_COLORS,
  type IconColorTokens,
  type ThemeColors,
} from '../icon/icon-theme';

/**
 * The Material 3 role each theme color takes from the wallpaper, so that
 * everything drawn with the theme, the Material designs and the app's own
 * classes alike, follows it with no colors of its own to set.
 *
 * - The app and its cards stand on the surface, and the Material designs'
 *   tonal surfaces (`bg-secondary`: bars, sheets, menus, the switch's track)
 *   on a surface container.
 * - Selected items (`bg-accent`) take the secondary container, as Material's
 *   selected chips and navigation items do.
 * - The destructive and chart colors aren't the wallpaper's: Material keeps
 *   errors red, and a chart's series tell data apart. So they stay the
 *   theme's, as do the clear glass's white and the dimming layer under it.
 */
export const DYNAMIC_THEME_ROLES: Readonly<Record<string, DynamicColorRole>> = {
  background: 'surface',
  foreground: 'onSurface',
  card: 'surface',
  'card-foreground': 'onSurface',
  primary: 'primary',
  'primary-foreground': 'onPrimary',
  secondary: 'surfaceContainerHigh',
  'secondary-foreground': 'onSurface',
  muted: 'surfaceContainerHighest',
  'muted-foreground': 'onSurfaceVariant',
  accent: 'secondaryContainer',
  'accent-foreground': 'onSecondaryContainer',
  border: 'outlineVariant',
  input: 'outlineVariant',
  ring: 'primary',
  'glass-tint': 'primary',
  'glass-tint-foreground': 'onPrimary',
  'glass-foreground': 'onSurface',
  'glass-muted-foreground': 'onSurfaceVariant',
};

/**
 * `#6750a4` as `103, 80, 164`, the form of the theme's `-rgb` twins.
 */
const channels = (hex: string): string =>
  [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16))
    .join(', ');

/**
 * The theme's colors in a dynamic color scheme, by token name without `--`,
 * each a complete `rgba()`, as the theme and its TypeScript copies write
 * them. `ring-subtle` is the ring at 40%, as in the theme.
 */
export const dynamicThemeColors = (
  scheme: DynamicColorScheme,
): IconColorTokens => {
  const colors: Record<string, string> = {};
  for (const [token, role] of Object.entries(DYNAMIC_THEME_ROLES)) {
    colors[token] = `rgba(${channels(scheme[role])}, 1)`;
  }
  colors['ring-subtle'] = `rgba(${channels(scheme.primary)}, 0.4)`;
  return colors;
};

/**
 * The CSS variables that give a theme color its value in a scheme: the color,
 * and for an opaque one its `-rgb` twin, which opacity modifiers such as
 * `bg-primary/50` read.
 */
const themeVariables = (scheme: DynamicColorScheme): Record<string, string> => {
  const variables: Record<string, string> = {};
  for (const [token, color] of Object.entries(dynamicThemeColors(scheme))) {
    variables[`--${token}`] = color;
  }
  for (const [token, role] of Object.entries(DYNAMIC_THEME_ROLES)) {
    variables[`--${token}-rgb`] = channels(scheme[role]);
  }
  return variables;
};

const providedColors = () => inject(UiDynamicColor).colors;

/**
 * Colors the theme from the user's wallpaper on Android 12 and later
 * (Material You's dynamic color), for everything inside the element it's on.
 * Put it on the app's root view, the one that switches the `dark` class:
 *
 * ```html
 * <view class="h-full bg-background" [class.dark]="theme.isDarkMode()" uiDynamicColor>
 * ```
 *
 * It sets the theme's own CSS variables (`--primary`, `--secondary` and the
 * others, with their `-rgb` twins) to the wallpaper's Material 3 roles (see
 * {@link DYNAMIC_THEME_ROLES}), inline, where they win over the theme's
 * `page` and `.dark` values. So the Material designs, and the app's own
 * `bg-primary` and `text-muted-foreground`, follow the wallpaper without a
 * second set of colors. Icons, glass tints and charts inside it, which draw
 * with a TypeScript copy of the theme, get the same colors.
 *
 * Which scheme it sets, light or dark, follows `provideIconTheme()`'s
 * `colorScheme`, as icons do: make it match the `dark` class.
 *
 * Where the host app sends no wallpaper colors (iOS, the web preview, Lynx
 * Explorer, Android before 12), it sets nothing and the theme stays as it is.
 * The colors come from `LynxTheme.dynamicColors`, which the Android app
 * `ng build --platform android` makes sends.
 */
@Directive({
  selector: '[uiDynamicColor]',
  host: { '[style]': 'style()' },
  providers: [{ provide: UI_THEME_COLORS, useFactory: providedColors }],
})
export class UiDynamicColor {
  readonly #dynamicColors = inject(LynxTheme).dynamicColors;
  readonly #scheme = injectColorScheme();

  /**
   * The theme's colors in each scheme from the wallpaper, or none, for what
   * draws inside the element and can't read its CSS variables (see
   * UI_THEME_COLORS).
   */
  readonly colors = computed<ThemeColors>(() => {
    const colors = this.#dynamicColors();
    return colors
      ? {
          light: dynamicThemeColors(colors.light),
          dark: dynamicThemeColors(colors.dark),
        }
      : {};
  });

  protected readonly style = computed(() => {
    const colors = this.#dynamicColors();
    return colors ? themeVariables(colors[this.#scheme()]) : null;
  });
}
