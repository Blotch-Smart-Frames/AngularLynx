/**
 * What `LynxStoreReview` calls, named as the shells name their module.
 */
const MODULE = 'AngularLynxStoreReview';

type FakeStoreReviewModule = {
  /** How many times the app has asked, in this test. */
  requests: number;
  request(done: (result: object) => void): void;
};

/**
 * Gives the environment's background thread an `AngularLynxStoreReview`
 * module, as the apps `ng build --platform` makes with angular.json's
 * `storeReview` have, which counts each request rather than asking a store.
 * `LynxStoreReview` reaches it through the background thread, as it reaches
 * the shells' module, so `request()` resolves as it does on a phone once
 * the store has the request.
 *
 * It runs each time the environment injects the background thread's
 * globals: when it's created, and on the reset after each test, so each test
 * starts with no requests counted.
 */
export const installStoreReviewModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const module: FakeStoreReviewModule = {
    requests: 0,
    request(done) {
      this.requests++;
      done({});
    },
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

/**
 * How many times the app has asked for a rating with
 * `LynxStoreReview.request()` in this test, so a spec can check it asks at
 * the right moment, and only then. Each test starts at 0. Nothing shows:
 * whether a store would show its prompt can't be known, on a phone either.
 *
 * @example
 * ```ts
 * fireEvent.tap(screen.getByText('Place order'));
 * await waitForUpdate();
 * expect(reviewRequests()).toBe(1);
 * ```
 */
export const reviewRequests = (): number => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const module = (globalThis as any).lynxTestingEnv?.backgroundThread.globalThis
    .NativeModules?.[MODULE] as FakeStoreReviewModule | undefined;
  return module?.requests ?? 0;
};
