/**
 * What `LynxTracking` calls, named as the shells name their module.
 */
const MODULE = 'AngularLynxTracking';

/**
 * Whether the app may track the person, as `LynxTracking`'s `status()`
 * reports it.
 */
export type FakeTrackingStatus =
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'notDetermined'
  | 'unsupported';

/** What the fake module remembers, in one test. */
type FakeTrackingState = {
  status: FakeTrackingStatus;
  /** What the person answers in the prompt. */
  answer: 'authorized' | 'denied';
  /** How many times the prompt has shown. */
  prompts: number;
};

type FakeTrackingModule = {
  readonly state: FakeTrackingState;
  status(done: (result: object) => void): void;
  request(done: (result: object) => void): void;
};

/**
 * Gives the environment's background thread an `AngularLynxTracking` module,
 * as the apps `ng build --platform` makes with `permissions.tracking` have.
 * It starts where a fresh install on an iPhone does, `notDetermined`, and
 * the person allows tracking when the app asks. `LynxTracking` reaches it
 * through the background thread, as it reaches the shells' module.
 *
 * It runs each time the environment injects the background thread's
 * globals: when it's created, and on the reset after each test, so each test
 * starts from a fresh install.
 */
export const installTrackingModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const state: FakeTrackingState = {
    status: 'notDetermined',
    answer: 'authorized',
    prompts: 0,
  };
  const module: FakeTrackingModule = {
    state,
    status(done) {
      done({ status: state.status });
    },
    // iOS shows the prompt only to a person who hasn't answered, and answers
    // with the status after that.
    request(done) {
      if (state.status === 'notDetermined') {
        state.prompts++;
        state.status = state.answer;
      }
      done({ status: state.status });
    },
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

const fakeState = (): FakeTrackingState | undefined =>
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  (
    (globalThis as any).lynxTestingEnv?.backgroundThread.globalThis
      .NativeModules?.[MODULE] as FakeTrackingModule | undefined
  )?.state;

/**
 * Sets whether the app may track the person, as if they'd answered the
 * prompt or changed it in Settings: what `LynxTracking.status()` reads, and
 * what `requestPermission()` resolves with, without a prompt unless it's
 * `notDetermined`. Each test starts at `notDetermined`.
 *
 * `LynxTracking` reads the status when it's created, and again when the app
 * comes back to the foreground, so set it before `render()`, or follow it
 * with `setAppState('background')` and `setAppState('active')`, as a person
 * coming back from Settings would.
 *
 * @example
 * ```ts
 * setTrackingStatus('denied');
 * await render(AdBanner);
 * expect(screen.getByText('Ads that respect your choice')).toBeInTheDocument();
 * ```
 */
export const setTrackingStatus = (status: FakeTrackingStatus): void => {
  const state = fakeState();
  if (state) state.status = status;
};

/**
 * Sets what the person answers when `requestPermission()` shows the prompt:
 * `authorized` (the default) or `denied`. The prompt shows only while the
 * status is `notDetermined`.
 *
 * @example
 * ```ts
 * setTrackingAnswer('denied');
 * fireEvent.tap(screen.getByText('Continue'));
 * await waitForUpdate();
 * expect(trackingPrompts()).toBe(1);
 * ```
 */
export const setTrackingAnswer = (answer: 'authorized' | 'denied'): void => {
  const state = fakeState();
  if (state) state.answer = answer;
};

/**
 * How many times `requestPermission()` has shown the prompt in this test, so
 * a spec can check the app asks at the right moment, and only once.
 */
export const trackingPrompts = (): number => fakeState()?.prompts ?? 0;
