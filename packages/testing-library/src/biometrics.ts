import type { BiometricsErrorCode, BiometryType } from '@blotch/angular-lynx';

/** What `LynxBiometrics` and `LynxSecureStorage` call, as the shells name it. */
const MODULE = 'AngularLynxBiometrics';

/** The phone {@link setBiometrics} describes. */
export type FakeBiometrics = {
  /** The sensor, `faceID` unless it's set. `none` for a phone without one. */
  readonly type?: BiometryType;
  /** Whether a face or a finger is set up, true unless it's set. */
  readonly enrolled?: boolean;
  /** Whether the phone has a passcode, true unless it's set. */
  readonly deviceCredential?: boolean;
};

/**
 * How the next prompt ends, as {@link queueBiometricResult} queues it: the
 * person confirms (`success`), or the error `LynxBiometrics` rejects with.
 */
export type BiometricResult = 'success' | BiometricsErrorCode;

/** A prompt the app showed, as {@link biometricPrompts} lists it. */
export type BiometricPrompt = {
  /** The reason it gave, or `''` for a guarded read that gave none. */
  readonly reason: string;
  /** Whether it let the person use the passcode instead. */
  readonly allowDeviceCredential: boolean;
};

type Done = (result: Record<string, unknown>) => void;

type FakeBiometricsModule = {
  phone: Required<FakeBiometrics>;
  readonly queued: BiometricResult[];
  readonly prompts: BiometricPrompt[];
  readonly guarded: Map<string, string>;
  availability(done: Done): void;
  authenticate(
    options: { reason: string; allowDeviceCredential?: boolean },
    done: Done,
  ): void;
  getItem(key: string, reason: string, done: Done): void;
  setItem(key: string, value: string, done: Done): void;
  removeItem(key: string, done: Done): void;
  clear(done: Done): void;
};

/** The phone a test starts with: Face ID, set up, behind a passcode. */
const DEFAULT_PHONE: Required<FakeBiometrics> = {
  type: 'faceID',
  enrolled: true,
  deviceCredential: true,
};

/**
 * Gives the environment's background thread an `AngularLynxBiometrics`
 * module, as the apps `ng build --platform` makes with
 * `permissions.biometrics` have. It stands for a phone with Face ID set up
 * (see {@link setBiometrics}), where each prompt succeeds unless a spec
 * queues another outcome ({@link queueBiometricResult}), and it keeps the
 * values `LynxSecureStorage` stores with `requireBiometrics`. The runtime
 * reaches it through the background thread, as it reaches the shells'
 * module, so specs see the runtime's own behavior.
 *
 * It runs each time the environment injects the background thread's
 * globals: when it's created, and on the reset after each test, so each test
 * starts with that phone, nothing queued and nothing stored.
 */
export const installBiometricsModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const module: FakeBiometricsModule = {
    phone: { ...DEFAULT_PHONE },
    queued: [],
    prompts: [],
    guarded: new Map(),
    availability(done) {
      done({ ...this.phone });
    },
    authenticate(options, done) {
      const allowDeviceCredential = options.allowDeviceCredential === true;
      const refusal = refuse(this.phone, allowDeviceCredential);
      if (refusal) return done(refusal);
      this.prompts.push({ reason: options.reason, allowDeviceCredential });
      done(outcome(this.queued.shift()));
    },
    getItem(key, reason, done) {
      const value = this.guarded.get(key);
      if (value === undefined) return done({});
      this.prompts.push({ reason, allowDeviceCredential: false });
      const result = outcome(this.queued.shift());
      done(result['error'] === undefined ? { value } : result);
    },
    setItem(key, value, done) {
      // Biometric values need a sensor and a passcode, as on a phone.
      if (this.phone.type === 'none' || !this.phone.deviceCredential) {
        return done({
          error: 'unavailable',
          message: 'This phone has no biometrics to keep the value behind.',
        });
      }
      this.guarded.set(key, value);
      done({});
    },
    removeItem(key, done) {
      this.guarded.delete(key);
      done({});
    },
    clear(done) {
      this.guarded.clear();
      done({});
    },
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

/**
 * Why `phone` can't show the prompt, if it can't.
 */
const refuse = (
  phone: Required<FakeBiometrics>,
  allowDeviceCredential: boolean,
): Record<string, unknown> | undefined => {
  if (allowDeviceCredential && phone.deviceCredential) return undefined;
  if (phone.type === 'none') return { error: 'unavailable' };
  if (!phone.enrolled) return { error: 'notEnrolled' };
  return undefined;
};

const outcome = (result: BiometricResult = 'success') =>
  result === 'success' ? {} : { error: result };

/**
 * The fake module, read through the environment rather than kept here:
 * under `ng test`, the setup file and the specs can load different copies of
 * this module.
 */
const fakeModule = (helper: string): FakeBiometricsModule => {
  const module = (globalThis as any).lynxTestingEnv?.backgroundThread.globalThis
    .NativeModules?.[MODULE] as FakeBiometricsModule | undefined;
  if (!module) {
    throw new Error(
      `${helper}() needs the testing library's environment, which its setup file installs.`,
    );
  }
  return module;
};

/**
 * Describes the phone `LynxBiometrics` sees in this test: its sensor,
 * whether a face or a finger is set up, and whether it has a passcode. Each
 * test starts with Face ID set up behind a passcode; what isn't given keeps
 * that value. `{ type: 'none' }` is a phone without a sensor, or an app
 * without `permissions.biometrics`: prompts then reject with `unavailable`,
 * as does `LynxSecureStorage`'s `requireBiometrics`.
 *
 * @example
 * ```ts
 * setBiometrics({ type: 'fingerprint', enrolled: false });
 * await render(Unlock);
 * expect(screen.getByText('Set up a fingerprint to unlock')).toBeInTheDocument();
 * ```
 */
export const setBiometrics = (phone: FakeBiometrics): void => {
  const module = fakeModule('setBiometrics');
  module.phone = { ...module.phone, ...phone };
};

/**
 * Has the next biometric prompt end with `result`: the person confirms
 * (`success`), or `LynxBiometrics.authenticate()`, or a `LynxSecureStorage`
 * read of a value kept behind biometrics, rejects with a `BiometricsError`
 * of that code. Results queue in order, one per prompt; once they run out,
 * prompts succeed. A prompt the phone can't show (see {@link setBiometrics})
 * takes none.
 *
 * @example
 * ```ts
 * queueBiometricResult('canceled');
 * fireEvent.tap(screen.getByText('Unlock'));
 * await waitForUpdate();
 * expect(screen.getByText('Still locked')).toBeInTheDocument();
 * ```
 */
export const queueBiometricResult = (result: BiometricResult): void => {
  fakeModule('queueBiometricResult').queued.push(result);
};

/**
 * The biometric prompts the app has shown in this test, oldest first: each
 * `authenticate()`, and each read of a value kept behind biometrics. Each
 * test starts with none.
 */
export const biometricPrompts = (): readonly BiometricPrompt[] => [
  ...fakeModule('biometricPrompts').prompts,
];
