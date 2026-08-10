import { computed, inject, Injectable } from '@angular/core';
import { LynxGlobalData } from '../data-flow/global-data';
import { LynxSystemInfo } from '../system-info/system-info';

/**
 * CSS `env()` value for the top safe area inset (notch / status bar).
 */
export const SAFE_AREA_INSET_TOP = 'env(safe-area-inset-top)';
/**
 * CSS `env()` value for the bottom safe area inset (home indicator).
 */
export const SAFE_AREA_INSET_BOTTOM = 'env(safe-area-inset-bottom)';
/**
 * CSS `env()` value for the left safe area inset.
 */
export const SAFE_AREA_INSET_LEFT = 'env(safe-area-inset-left)';
/**
 * CSS `env()` value for the right safe area inset.
 */
export const SAFE_AREA_INSET_RIGHT = 'env(safe-area-inset-right)';

/**
 * Provides device adaptation helpers for notch/safe-area-aware layouts.
 *
 * Safe area insets in Lynx are applied via CSS `env(safe-area-inset-*)`,
 * identical to the web platform. This service exposes the `isNotchScreen`
 * flag from the native host as a reactive signal for conditional logic.
 *
 * @usageNotes
 *
 * ### CSS approach (preferred)
 * ```css
 * .container {
 *   padding-top: env(safe-area-inset-top);
 *   padding-bottom: env(safe-area-inset-bottom);
 * }
 * ```
 *
 * ### Conditional logic in TypeScript
 * ```typescript
 * const safeArea = inject(LynxSafeArea);
 *
 * if (safeArea.isNotchScreen()) {
 *   // Adjust layout for notch devices
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxSafeArea {
  readonly #globalData = inject(LynxGlobalData);
  readonly #systemInfo = inject(LynxSystemInfo);

  /**
   * Whether the device has a display notch or cutout. Reactive — updates when global props change.
   */
  readonly isNotchScreen = computed(
    () =>
      !!(this.#globalData.globalData() as Record<string, unknown>)[
        'isNotchScreen'
      ],
  );

  /**
   * The current platform (`'iOS'`, `'Android'`, `'Harmony'`, etc.).
   */
  get platform() {
    return this.#systemInfo.platform;
  }
}
