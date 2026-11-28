import {
  effect,
  inject,
  Injectable,
  type Signal,
  signal,
  untracked,
} from '@angular/core';
import { LynxAppState } from '../app-state/app-state';
import { callOnBackground } from '../background-call';

/**
 * The native module of the apps `ng build --platform` makes with
 * `permissions.tracking` in angular.json (`TrackingModule.swift` and
 * `TrackingModule.kt` in `packages/native/templates`).
 */
const TRACKING_MODULE = 'AngularLynxTracking';

/**
 * Whether the app may track the person across other companies' apps and
 * websites, as an ad or install-attribution SDK does with the advertising
 * ID:
 *
 * - `authorized`: it may. On iOS the person allowed it in App Tracking
 *   Transparency's prompt; on Android they haven't opted out of
 *   personalized ads or deleted their advertising ID.
 * - `denied`: it may not. On iOS the person declined, or turned off "Allow
 *   Apps to Request to Track" in Settings; on Android they opted out of
 *   personalized ads or deleted the ID, which then reads as zeros.
 * - `restricted`: iOS only. The phone doesn't let the person choose, as
 *   under parental controls or a work profile, and the app may not track.
 * - `notDetermined`: iOS only. The person hasn't been asked yet, so
 *   {@link LynxTracking.requestPermission} will show the prompt.
 * - `unsupported`: there's no advertising ID to track with: Lynx Explorer,
 *   the web preview, an app built without `permissions.tracking`, or an
 *   Android phone without Google Play services.
 */
export type TrackingStatus =
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'notDetermined'
  | 'unsupported';

const STATUSES: readonly TrackingStatus[] = [
  'authorized',
  'denied',
  'restricted',
  'notDetermined',
  'unsupported',
];

/**
 * Asks the person whether the app may track them, and says what they
 * answered, so an ad or install-attribution SDK only reads the advertising
 * ID once they've allowed it.
 *
 * - **iOS:** App Tracking Transparency (`ATTrackingManager`). Since iOS 14.5
 *   the advertising ID reads as zeros until the person allows tracking in its prompt,
 *   and App Review rejects an app that tracks without asking (guideline
 *   5.1.2). iOS shows the prompt once per install, with angular.json's
 *   `permissions.tracking` as its reason; after that, `requestPermission()`
 *   answers at once.
 * - **Android:** there's no prompt. Google Play gives an app targeting
 *   Android 13 or later the advertising ID only when it declares the
 *   `AD_ID` permission, which `permissions.tracking` does. The person can
 *   still opt out of personalized ads or delete the ID in Settings, which
 *   {@link status} reports as `denied`, and Play's policy says to respect it.
 * - **Web preview, Lynx Explorer and an app without `permissions.tracking`:**
 *   `unsupported`.
 *
 * Only the apps `ng build --platform` makes have the native module, and only
 * with the permission in angular.json, which gives iOS the prompt's reason:
 *
 * ```jsonc
 * "permissions": { "tracking": "Shows you ads that match your interests" }
 * ```
 *
 * The status is read when the service is created, and again each time the
 * app comes back to the foreground, since the person can change it in
 * Settings meanwhile. Until the first answer, a moment after the service is
 * created, it's `notDetermined`. Under the testing library,
 * `setTrackingStatus()` sets it, and `setTrackingAnswer()` what the prompt
 * answers.
 *
 * @usageNotes
 * ```typescript
 * // Injected in a field: a method has no injection context, even after
 * // an await.
 * readonly #tracking = inject(LynxTracking);
 *
 * async startAds() {
 *   // Shows the prompt the first time, and answers at once after that.
 *   if ((await this.#tracking.requestPermission()) === 'authorized') {
 *     this.#ads.start({ personalized: true });
 *   } else {
 *     this.#ads.start({ personalized: false });
 *   }
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxTracking {
  readonly #status = signal<TrackingStatus>('notDetermined');

  /**
   * Counts the module's answers, so one that comes after a newer one (a
   * status read the prompt overtook, say) doesn't replace it.
   */
  #asked = 0;

  /** Whether the app may track the person (see {@link TrackingStatus}). */
  readonly status: Signal<TrackingStatus> = this.#status.asReadonly();

  constructor() {
    void this.#ask('status');
    // The person can change it in Settings while the app is away, so read it
    // again when the app comes back.
    const appState = inject(LynxAppState);
    let wasActive = untracked(appState.active);
    effect(() => {
      const active = appState.active();
      if (active && !wasActive) untracked(() => void this.#ask('status'));
      wasActive = active;
    });
  }

  /**
   * Shows App Tracking Transparency's prompt on iOS, if the person hasn't
   * been asked yet, and resolves with their answer, which {@link status}
   * then holds too. iOS shows it only while the app is active, so a request
   * made before then waits for it. Anywhere else, and once the person has
   * answered, it resolves with the status without showing anything. Never
   * rejects.
   */
  requestPermission(): Promise<TrackingStatus> {
    return this.#ask('request');
  }

  async #ask(method: 'status' | 'request'): Promise<TrackingStatus> {
    const asked = ++this.#asked;
    let status: TrackingStatus;
    try {
      const result = (await callOnBackground(
        'callNativeModuleAsync',
        TRACKING_MODULE,
        method,
        [],
      )) as { readonly status?: string } | undefined;
      // A status the runtime doesn't know, from a newer shell, mustn't let
      // the app track.
      status = STATUSES.includes(result?.status as TrackingStatus)
        ? (result!.status as TrackingStatus)
        : 'denied';
    } catch {
      // The host has no module: Lynx Explorer, the web preview, or an app
      // built without permissions.tracking.
      status = 'unsupported';
    }
    if (asked === this.#asked) this.#status.set(status);
    return status;
  }
}
