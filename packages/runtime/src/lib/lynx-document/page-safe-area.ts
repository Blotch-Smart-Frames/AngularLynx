import type { Subscription } from 'rxjs';
import { globalDataUpdates } from '../data-flow/host-updates';
import { LynxElement, scheduleSettleFlush } from '../lynx-element';
import { setSafeAreaInsets } from '../lynx-element/safe-area-insets';

/** The current page's subscription, ended when another page takes over. */
let following: Subscription | undefined;

/**
 * Gives `env(safe-area-inset-*)` the insets from the global props, and again
 * whenever the host sends new ones (see safe-area-insets.ts): the stylesheets
 * through `page`'s CSS variables, and inline styles written with them.
 *
 * It starts before the app renders, so the first frame already has the insets
 * the shell sent with the bundle. The shells send new ones when the window's
 * insets change: on rotation, on iOS once the view is laid out in its window
 * (after the first global props), and on Android when the keyboard opens over
 * the navigation bar.
 *
 * A host update arrives outside change detection, so nothing else would flush
 * the new styles to the screen: scheduleSettleFlush() does.
 *
 * Each app's root document calls it for its page. A hot update's new app takes
 * over the same page (see takeOverPage), and a test's new app gets a new one,
 * so the previous subscription ends: one page follows the updates at a time.
 */
export const followSafeAreaInsets = (page: LynxElement): void => {
  following?.unsubscribe();
  setSafeAreaInsets(
    typeof lynx !== 'undefined' ? lynx.__globalProps : undefined,
  );
  // A new wrapper, even of a page taken over, has no runtime style yet.
  page.updateSafeAreaInsets();
  following = globalDataUpdates.subscribe((globalProps) => {
    if (!setSafeAreaInsets(globalProps)) return;
    page.updateSafeAreaInsets();
    LynxElement.refreshSafeAreaInsets();
    scheduleSettleFlush();
  });
};
