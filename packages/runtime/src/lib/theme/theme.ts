import { computed, inject, Injectable } from '@angular/core';
import { LynxGlobalData } from '../data-flow/global-data';

/**
 * The Material 3 color roles that dynamic color gives, by Material's names.
 * The error roles aren't here: Material keeps them red whatever the
 * wallpaper.
 */
export const DYNAMIC_COLOR_ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'inversePrimary',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'background',
  'onBackground',
  'surface',
  'onSurface',
  'surfaceVariant',
  'onSurfaceVariant',
  'surfaceDim',
  'surfaceBright',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'inverseSurface',
  'inverseOnSurface',
  'outline',
  'outlineVariant',
] as const;

export type DynamicColorRole = (typeof DYNAMIC_COLOR_ROLES)[number];

/**
 * Each role's color, as a hex color such as `#6750a4`.
 */
export type DynamicColorScheme = { readonly [R in DynamicColorRole]: string };

/** The color scheme for each appearance: the app can be in either. */
export type DynamicColors = {
  readonly light: DynamicColorScheme;
  readonly dark: DynamicColorScheme;
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * A scheme as the host sent it, if it has a hex color (`#6750a4`) for every
 * role.
 * Half a scheme would mix the wallpaper's colors with the app's, so it counts
 * as none.
 */
const parseScheme = (value: unknown): DynamicColorScheme | null => {
  if (typeof value !== 'object' || value === null) return null;
  const colors = value as Record<string, unknown>;
  const scheme: Record<string, string> = {};
  for (const role of DYNAMIC_COLOR_ROLES) {
    const color = colors[role];
    if (typeof color !== 'string' || !HEX_COLOR.test(color)) return null;
    scheme[role] = color;
  }
  return scheme as DynamicColorScheme;
};

const parseDynamicColors = (value: unknown): DynamicColors | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { light, dark } = value as Record<string, unknown>;
  const lightScheme = parseScheme(light);
  const darkScheme = parseScheme(dark);
  return lightScheme && darkScheme
    ? { light: lightScheme, dark: darkScheme }
    : null;
};

const sameColors = (a: DynamicColors | null, b: DynamicColors | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    DYNAMIC_COLOR_ROLES.every(
      (role) =>
        a.light[role] === b.light[role] && a.dark[role] === b.dark[role],
    ));

/**
 * Provides reactive access to the current Lynx theme ('Dark' or 'Light').
 *
 * The theme is driven by `lynx.__globalProps.theme`, which the native host
 * sets based on the OS appearance setting. It updates reactively when the
 * host calls `updateGlobalProps`.
 *
 * @usageNotes
 * ```typescript
 * const theme = inject(LynxTheme);
 *
 * // Reactive in templates
 * template: `<text [style.color]="theme.isDarkMode() ? '#fff' : '#000'">Hello</text>`
 *
 * // Or use CSS variables (preferred for styling — see docs/guide/dark-mode.mdx)
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxTheme {
  readonly #globalData = inject(LynxGlobalData);

  /**
   * The current theme: `'Dark'` or `'Light'`. Reactive — updates when global props change.
   */
  readonly theme = computed(() => {
    const value = (this.#globalData.globalData() as Record<string, unknown>)[
      'theme'
    ];
    return (value as 'Dark' | 'Light') ?? 'Light';
  });

  /**
   * Whether the current theme is dark mode. Reactive.
   */
  readonly isDarkMode = computed(() => this.theme() === 'Dark');

  /**
   * The colors Android 12 and later take from the user's wallpaper (Material
   * You's dynamic color), as Material 3's color roles in light and dark, or
   * `null` where the host sends none.
   *
   * Lynx has no API for them, so they come from the host app, in its
   * `dynamicColors` global prop: `{ light, dark }`, each with a hex color,
   * such as `#6750a4`, for every role in {@link DYNAMIC_COLOR_ROLES}. The
   * Android app `ng build --platform android` makes sends them, and new ones
   * when the user changes their wallpaper or colors. iOS, the web preview and
   * Lynx Explorer have none.
   *
   * Both schemes come at once, so an app with a dark mode of its own can
   * follow it rather than the phone's.
   */
  readonly dynamicColors = computed(
    () =>
      parseDynamicColors(
        (this.#globalData.globalData() as Record<string, unknown>)[
          'dynamicColors'
        ],
      ),
    // Every global prop update reaches here, such as new safe-area insets,
    // and the colors seldom change with them.
    { equal: sameColors },
  );
}
