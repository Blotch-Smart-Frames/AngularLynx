import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';
import type { PlatformType } from '../system-info/system-info';

/**
 * The native module of the apps `ng build --platform` makes
 * (`HapticsModule.swift` and `HapticsModule.kt` in `packages/native/templates`).
 */
const HAPTICS_MODULE = 'AngularLynxHaptics';

/**
 * How hard an {@link LynxHaptics.impact} taps, as iOS's
 * `UIImpactFeedbackGenerator.FeedbackStyle` names it: `light`, `medium` and
 * `heavy` for objects of that weight, `soft` for a flexible one and `rigid`
 * for a stiff one. Android has fewer kinds, so `soft` taps as `light` there
 * and `rigid` as `medium`.
 */
export type HapticImpactStyle = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid';

/**
 * What a {@link LynxHaptics.notification} reports, as iOS's
 * `UINotificationFeedbackGenerator.FeedbackType` names it.
 */
export type HapticNotificationType = 'success' | 'warning' | 'error';

/**
 * How long the web preview vibrates for each kind of feedback, in
 * milliseconds, as `navigator.vibrate()` takes it: a single number, or
 * vibrations and pauses in turn. A phone's motor can't play an iPhone's
 * short taps, so these are the shortest a motor makes felt.
 */
const VIBRATIONS = {
  selection: 8,
  light: 10,
  soft: 10,
  medium: 15,
  rigid: 15,
  heavy: 25,
  success: [10, 60, 10],
  warning: [20, 80, 20],
  error: [20, 60, 20, 60, 20],
} satisfies Record<
  'selection' | HapticImpactStyle | HapticNotificationType,
  number | number[]
>;

/** The part of a browser window the web preview's feedback uses. */
type BrowserWindow = {
  readonly navigator: { vibrate?(pattern: number | number[]): boolean };
};

/**
 * The page's window in Lynx for Web, or undefined elsewhere.
 *
 * Web-core runs the main thread, where Angular runs, in a hidden iframe.
 * Browsers let a page vibrate only after the person has tapped in it, and
 * the taps land in the page around the iframe, so the vibration goes through
 * that page (see `LynxClipboard`, which reaches it the same way).
 */
const pageWindow = (): BrowserWindow | undefined => {
  if (
    typeof SystemInfo === 'undefined' ||
    // The global is typed by `@lynx-js/types`, whose PlatformType leaves out
    // the 'web' web-core reports; AngularLynx's own PlatformType has it.
    (SystemInfo.platform as PlatformType) !== 'web'
  ) {
    return undefined;
  }
  const self = globalThis as unknown as { parent?: BrowserWindow };
  return self.parent ?? (self as unknown as BrowserWindow);
};

/**
 * Whether this runs under the testing library, whose environment keeps
 * itself in the `lynxTestingEnv` global (see background-call.ts).
 */
const inTestingEnvironment = (): boolean =>
  (globalThis as { lynxTestingEnv?: unknown }).lynxTestingEnv !== undefined;

/**
 * Taps the phone, as a native control does when something under the finger
 * changes: `UIImpactFeedbackGenerator`, `UISelectionFeedbackGenerator` and
 * `UINotificationFeedbackGenerator` on iOS, and `View.performHapticFeedback()`
 * on Android. Lynx has no `navigator.vibrate()`, the web's nearest API.
 *
 * - **iOS:** the haptic engine. iOS plays nothing when the person has
 *   turned System Haptics off, in Low Power Mode, or while the camera or
 *   the microphone records.
 * - **Android:** the window's own haptic feedback, which needs no
 *   permission and follows the person's touch feedback setting. Each kind
 *   uses the nearest of Android's `HapticFeedbackConstants`, and the
 *   phone's vibration motor plays it as it plays the system's own.
 * - **Web:** `navigator.vibrate()` of the page, which Chrome on Android
 *   plays after the person has tapped in the page, and Safari and desktop
 *   browsers don't have.
 * - **Lynx Explorer and the testing library:** nothing.
 *
 * Only the apps `ng build --platform` makes have the native module behind
 * it, `AngularLynxHaptics`. The methods never throw or reject: feedback a
 * host can't give is left out, as it is on a phone without a haptic engine.
 *
 * Give it for a change the person made, as it happens: a value passing a
 * detent, a selection moving, an action confirmed. Apple and Google both
 * ask that it be used sparingly, so that it keeps its meaning. The
 * `@blotch/ui` slider, switch, segmented control and context menu give
 * theirs already.
 *
 * @usageNotes
 * ```typescript
 * const haptics = inject(LynxHaptics);
 *
 * haptics.selection(); // A picker's value moved one place.
 * haptics.impact('light'); // Something snapped into place.
 * haptics.notification('success'); // A payment went through.
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxHaptics {
  /**
   * The host turned out to have no haptics module, as in Lynx Explorer, so
   * later feedback doesn't cross to the background thread to find that out
   * again: a slider can ask for it on every frame of a drag.
   */
  #unavailable = false;

  /**
   * An impact: something hit something else, such as a view snapping into
   * place or a control reaching its end. `style` says how hard (`medium`
   * unless it's given).
   */
  impact(style: HapticImpactStyle = 'medium'): void {
    this.#play('impact', style in VIBRATIONS ? style : 'medium');
  }

  /**
   * A selection tick: a picker's or a segmented control's selection moved,
   * or a value passed a detent. The lightest feedback, and the one to give
   * repeatedly as something moves.
   */
  selection(): void {
    this.#play('selection');
  }

  /**
   * A task's outcome: it succeeded, it needs the person's attention
   * (`warning`) or it failed. `success` unless it's given.
   */
  notification(type: HapticNotificationType = 'success'): void {
    this.#play('notification', type in VIBRATIONS ? type : 'success');
  }

  #play(
    method: 'impact' | 'selection' | 'notification',
    kind?: HapticImpactStyle | HapticNotificationType,
  ): void {
    // Under the testing library first: a spec that renders as the web
    // preview (SystemInfo's platform 'web') plays nothing either.
    if (inTestingEnvironment()) return;
    const page = pageWindow();
    if (page) {
      try {
        page.navigator.vibrate?.(VIBRATIONS[kind ?? 'selection']);
      } catch {
        // A browser that refuses throws in some versions rather than
        // returning false. Feedback is never worth an error.
      }
      return;
    }
    if (this.#unavailable) return;
    callOnBackground(
      'callNativeModuleAsync',
      HAPTICS_MODULE,
      method,
      kind === undefined ? [] : [kind],
    ).catch(() => {
      this.#unavailable = true;
    });
  }
}
