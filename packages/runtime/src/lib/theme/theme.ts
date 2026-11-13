import {
  computed,
  type EnvironmentProviders,
  inject,
  Injectable,
  provideEnvironmentInitializer,
} from '@angular/core';
import { LynxGlobalData } from '../data-flow/global-data';
import {
  colorSchemePreference,
  type LynxAppearance,
  type LynxColorScheme,
  setColorSchemePreference,
  systemThemeOf,
} from './color-scheme';

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
 * Sets what the app draws in from its first frame, in `app.config.ts`:
 * `'light'` or `'dark'` to keep to one whatever the device says, or
 * `'system'`, the default, to follow the device.
 *
 * ```ts
 * // An app with no dark design yet.
 * providers: [provideColorScheme('light')]
 * ```
 *
 * For a choice the user makes while the app runs, such as an Appearance
 * setting, call `LynxTheme.setColorScheme()` instead.
 */
export const provideColorScheme = (
  scheme: LynxColorScheme,
): EnvironmentProviders =>
  provideEnvironmentInitializer(() => setColorSchemePreference(scheme));

/**
 * The device's light or dark appearance, and the one the app draws in.
 *
 * The app follows the device by default. While it's drawn dark, the `page`
 * element has the `dark` class, so a stylesheet's dark values go under
 * `page.dark` and nothing in the app has to switch them:
 *
 * ```css
 * page { --surface: #ffffff; }
 * page.dark { --surface: #1a1a1a; }
 * ```
 *
 * The device's theme comes from `lynx.__globalProps.theme`, which the native
 * host sets from the OS appearance setting and sends again when it changes.
 * In the web preview, where no host sends one, it's the browser's
 * `prefers-color-scheme`.
 *
 * @usageNotes
 * ```typescript
 * const theme = inject(LynxTheme);
 *
 * // What the app is drawn in, for what CSS can't reach, such as an image.
 * readonly logo = computed(() =>
 *   theme.appearance() === 'dark' ? 'logo-dark.png' : 'logo.png',
 * );
 *
 * // An Appearance setting: 'system', 'light' or 'dark'.
 * theme.setColorScheme('dark');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxTheme {
  readonly #globalData = inject(LynxGlobalData);

  /**
   * The device's theme: `'Dark'` or `'Light'`. Reactive: it updates when the
   * host sends new global props, or the browser's preference changes.
   */
  readonly theme = computed(() => systemThemeOf(this.#globalData.globalData()));

  /**
   * Whether the device is in dark mode. Reactive. The app may be drawn
   * otherwise, if it chose a color scheme itself: see {@link appearance}.
   */
  readonly isDarkMode = computed(() => this.theme() === 'Dark');

  /**
   * The app's choice: `'system'` (the default) follows the device, and
   * `'light'` and `'dark'` keep to one. Set it with {@link setColorScheme},
   * or from the start with `provideColorScheme()`.
   */
  readonly colorScheme = colorSchemePreference;

  /**
   * The appearance the app is drawn in, `'light'` or `'dark'`: its own
   * choice, or the device's while that's `'system'`. The `page` element has
   * the `dark` class while it's `'dark'`. Read it for what CSS can't follow,
   * such as an image or the colors of a chart.
   */
  readonly appearance = computed<LynxAppearance>(() => {
    const scheme = this.colorScheme();
    if (scheme !== 'system') return scheme;
    return this.isDarkMode() ? 'dark' : 'light';
  });

  /**
   * Draws the app light or dark whatever the device says, or with
   * `'system'` follows the device again. It lasts until the app closes:
   * store the user's choice, such as with `LynxLocalStorage`, and set it
   * again at the next start.
   */
  setColorScheme(scheme: LynxColorScheme): void {
    setColorSchemePreference(scheme);
  }

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
