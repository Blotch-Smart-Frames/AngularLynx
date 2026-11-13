import { merge, type Subscription } from 'rxjs';
import { globalDataUpdates } from '../data-flow/host-updates';
import { type LynxElement, scheduleSettleFlush } from '../lynx-element';
import {
  appearanceOf,
  colorSchemeChanges,
  watchBrowserColorScheme,
} from '../theme/color-scheme';

/** The class the page has while the app is drawn dark. */
export const DARK_CLASS = 'dark';

/** The current page's subscription, ended when another page takes over. */
let following: Subscription | undefined;

/**
 * The window a page is drawn in, on Lynx for Web: the main thread runs in an
 * iframe while its elements belong to the page, so the browser's preference
 * comes from the page element's window, not this realm's. Native Lynx has no
 * windows.
 */
const windowOf = (page: LynxElement): Window | undefined => {
  if (!__WEB__) return undefined;
  const element = page.element as unknown as { ownerDocument?: Document };
  return element.ownerDocument?.defaultView ?? undefined;
};

/**
 * Gives `page` the `dark` class while the app is drawn dark: while the device
 * is, or while the app chose dark itself (see LynxTheme.setColorScheme). A
 * stylesheet puts its dark values under `page.dark`, and every element reads
 * them, as CSS variables inherit:
 *
 * ```css
 * page { --background: #ffffff; }
 * page.dark { --background: #09090b; }
 * ```
 *
 * Lynx has no `prefers-color-scheme` media query, and Angular has no template
 * for `page`, so nothing an app writes could put a class there.
 *
 * It starts before the app renders, so the first frame is already in the
 * theme the shell sent with the bundle: no flash of light. The shells send a
 * new theme when the phone switches, and the web preview follows the
 * browser's preference.
 *
 * A change arrives outside change detection, so nothing else would flush the
 * new class to the screen: scheduleSettleFlush() does.
 *
 * Each app's root document calls it for its page, as followSafeAreaInsets:
 * one page follows at a time.
 */
export const followColorScheme = (page: LynxElement): void => {
  following?.unsubscribe();
  watchBrowserColorScheme(windowOf(page));
  const dark = () =>
    appearanceOf(
      typeof lynx !== 'undefined' ? lynx.__globalProps : undefined,
    ) === 'dark';
  page.setRuntimeClass(DARK_CLASS, dark());
  following = merge(globalDataUpdates, colorSchemeChanges).subscribe(() => {
    // Most global props updates leave the theme as it was, such as new
    // safe-area insets: only a change is worth a flush.
    if (page.setRuntimeClass(DARK_CLASS, dark())) scheduleSettleFlush();
  });
};
