import { signal } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * What the app draws in: `'system'` follows the device's appearance, and
 * `'light'` and `'dark'` keep to one whatever the device says.
 */
export type LynxColorScheme = 'system' | 'light' | 'dark';

/** The appearance the app is drawn in. */
export type LynxAppearance = 'light' | 'dark';

/**
 * The app's choice. It lives here rather than in LynxTheme because the page
 * takes its `dark` class from it before Angular has made any service (see
 * followColorScheme), and one page follows it whichever app set it.
 */
const preference = signal<LynxColorScheme>('system');

/**
 * Whether the browser prefers a dark color scheme, in the web preview. Native
 * Lynx has no media queries: there, a host sends the theme in its global
 * props.
 */
const browserDark = signal(false);

/**
 * Emits when the app's choice or the browser's preference changes, for the
 * page, which follows them outside Angular, where no effect can run. Signal
 * readers such as LynxTheme don't need it.
 */
export const colorSchemeChanges = new Subject<void>();

/** The app's choice, as a signal. */
export const colorSchemePreference = preference.asReadonly();

/** Sets the app's choice, and tells the page. */
export const setColorSchemePreference = (scheme: LynxColorScheme): void => {
  if (preference() === scheme) return;
  preference.set(scheme);
  colorSchemeChanges.next();
};

let stopWatching: (() => void) | undefined;

/**
 * Follows a window's `prefers-color-scheme`, for the web preview, where no
 * host sends a theme. Each call replaces the last one's listener: a hot
 * update's new app watches the same window again. Without a window that has
 * media queries, as on native Lynx, the browser's preference counts as light.
 */
export const watchBrowserColorScheme = (win: Window | undefined): void => {
  stopWatching?.();
  stopWatching = undefined;
  const query =
    typeof win?.matchMedia === 'function'
      ? win.matchMedia('(prefers-color-scheme: dark)')
      : undefined;
  browserDark.set(query?.matches ?? false);
  if (!query) return;
  const update = () => {
    browserDark.set(query.matches);
    colorSchemeChanges.next();
  };
  query.addEventListener('change', update);
  stopWatching = () => query.removeEventListener('change', update);
};

/**
 * The device's theme: the `theme` a host app sends in its global props, or
 * without one, as in the web preview, the browser's preference. A host's
 * value wins, so a page that embeds the app can set the theme itself.
 */
export const systemThemeOf = (globalProps: unknown): 'Dark' | 'Light' => {
  const theme = (globalProps as Record<string, unknown> | null | undefined)?.[
    'theme'
  ];
  return (
    (theme as 'Dark' | 'Light' | null | undefined) ??
    (browserDark() ? 'Dark' : 'Light')
  );
};

/**
 * The appearance the app draws in: its own choice, or with `'system'` the
 * device's.
 */
export const appearanceOf = (globalProps: unknown): LynxAppearance => {
  const scheme = preference();
  if (scheme !== 'system') return scheme;
  return systemThemeOf(globalProps) === 'Dark' ? 'dark' : 'light';
};
