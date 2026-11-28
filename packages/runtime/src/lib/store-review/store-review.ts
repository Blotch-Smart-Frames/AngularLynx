import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';

/**
 * The native module of the apps `ng build --platform` makes with angular.json's
 * `storeReview` (`StoreReviewModule.swift` and `StoreReviewModule.kt` in
 * `packages/native/templates`).
 */
const STORE_REVIEW_MODULE = 'AngularLynxStoreReview';

/**
 * Asks the person to rate the app without leaving it: StoreKit's rating
 * prompt on iOS (`AppStore.requestReview(in:)`), and Google Play's In-App
 * Review API on Android. Both stores require their own prompt for this
 * (Apple's guideline 5.6.1 forbids a custom one), and `LynxLinking` can only
 * open the store's page, which takes the person out of the app.
 *
 * The store decides whether the prompt shows, and never says:
 *
 * - **iOS:** at most three times in 365 days in an App Store build, never in
 *   a TestFlight build, and every time in a development build (the
 *   Simulator's included), where it can't submit a rating.
 * - **Android:** within a quota Play doesn't publish, only once the account
 *   has installed the app from Google Play (an internal test track or
 *   internal app sharing will do; a local build installs over it only when
 *   its signing certificate is compatible with Play's), and never where the phone has no
 *   Play Store.
 * - **Web preview, Lynx Explorer and the testing library:** never.
 *
 * So {@link request} resolves with nothing once the request is made,
 * whether or not a prompt showed, and never rejects. Ask after a moment of
 * success, such as a finished order or a level won, and never from a button
 * or behind a "Do you like the app?" question: Apple's guidelines and Play's
 * policy forbid both, and a prompt the store chose not to show would leave
 * the button doing nothing.
 *
 * The native module is in an app only when angular.json's build options set
 * `"storeReview": true`, which also adds Play's review library to the
 * Android app. Without it, `request()` resolves without showing anything, as
 * in Lynx Explorer. The testing library's `reviewRequests()` counts the
 * requests a spec's app made.
 *
 * @usageNotes
 * ```typescript
 * const storeReview = inject(LynxStoreReview);
 *
 * async finishOrder() {
 *   await this.orders.place(this.cart());
 *   // A success moment, not a button: the store decides whether to show it.
 *   await storeReview.request();
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxStoreReview {
  /**
   * Asks the store for its rating prompt. Resolves once the request is made
   * (on Android, once the prompt has closed or the store chose not to show
   * it), whether or not anything showed, and never rejects.
   */
  async request(): Promise<void> {
    try {
      // callNativeModuleAsync keeps the module's callback on the background
      // thread, where NativeModules lives, so nothing stays registered once
      // it answers.
      await callOnBackground(
        'callNativeModuleAsync',
        STORE_REVIEW_MODULE,
        'request',
        [],
      );
    } catch {
      // The host has no module: Lynx Explorer, the web preview, or an app
      // built without `storeReview`. To the app that's the same as a store
      // choosing not to show the prompt.
    }
  }
}
