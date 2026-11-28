/** What `LynxMotion` calls and hears, named as the shells name them. */
const MODULE = 'AngularLynxMotion';
const EVENT = 'angularLynxMotion';

type Sensor = 'acceleration' | 'rotation' | 'orientation' | 'heading' | 'shake';

type FakeMotionModule = {
  /** The sensors the app has started, as the shells run them. */
  readonly running: Set<Sensor>;
  /** The time of the last sample sent, so each comes after it. */
  last: number;
  start(sensor: Sensor, interval: number): void;
  stop(sensor: Sensor): void;
  availability(done: (result: Record<string, boolean>) => void): void;
};

type BackgroundGlobals = {
  NativeModules?: Record<string, unknown>;
  lynx?: {
    getJSModule?(
      name: string,
    ): { emit(name: string, params: unknown[]): void } | undefined;
  };
};

/** The part of `@lynx-js/testing-environment`'s environment this uses. */
type TestingEnvironment = {
  readonly backgroundThread: { readonly globalThis: BackgroundGlobals };
  switchToBackgroundThread(): void;
  switchToMainThread(): void;
};

/** A vector along the phone's axes, as {@link emitMotion} takes it. */
export type MotionVector = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/** What {@link emitMotion} sends: any of the sensors, sampled at once. */
export type EmittedMotion = {
  /** The acceleration with gravity, in m/s² (face up at rest: z 9.81). */
  readonly acceleration?: MotionVector;
  /** How fast the phone turns around each axis, in radians a second. */
  readonly rotation?: MotionVector;
  /** Which way it faces, as `DeviceOrientationEvent`'s angles in degrees. */
  readonly orientation?: {
    readonly alpha: number;
    readonly beta: number;
    readonly gamma: number;
  };
  /**
   * When it was measured, in milliseconds since the epoch. A second after
   * the last sample unless it's given (or `Date.now()`, if that's later), so
   * a sample is never too soon for a watch's `interval`.
   */
  readonly timestamp?: number;
};

/** What {@link setHeading} takes besides a magnetic heading alone. */
export type EmittedHeading = {
  readonly magneticHeading: number;
  readonly trueHeading?: number | null;
  readonly accuracy?: number | null;
  readonly timestamp?: number;
};

/**
 * Gives the environment's background thread an `AngularLynxMotion` module,
 * as the apps `ng build --platform` makes with angular.json's `motion` have:
 * a phone with every sensor, which samples only what {@link emitMotion},
 * {@link setHeading} and {@link shakeDevice} send, and only while the app
 * runs the sensor, as a phone sends nothing for a sensor nobody watches.
 *
 * It runs each time the environment injects the background thread's
 * globals: when it's created, and on the reset after each test.
 */
export const installMotionModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const running = new Set<Sensor>();
  const module: FakeMotionModule = {
    running,
    last: -Infinity,
    start: (sensor) => void running.add(sensor),
    stop: (sensor) => void running.delete(sensor),
    availability: (done) =>
      done({
        acceleration: true,
        rotation: true,
        orientation: true,
        heading: true,
      }),
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

const environment = (
  caller: string,
): { env: TestingEnvironment; module: FakeMotionModule } => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const env = (globalThis as any).lynxTestingEnv as
    | TestingEnvironment
    | undefined;
  const module = env?.backgroundThread.globalThis.NativeModules?.[MODULE] as
    | FakeMotionModule
    | undefined;
  if (!env || !module) {
    throw new Error(
      `${caller}() needs the testing library's environment, which its setup file installs.`,
    );
  }
  return { env, module };
};

/**
 * The time of the next sample: as given, or after the last one.
 */
const nextTime = (module: FakeMotionModule, timestamp?: number): number => {
  const t = timestamp ?? Math.max(Date.now(), module.last + 1000);
  module.last = t;
  return t;
};

/**
 * Sends the batch as the shells' global event. It arrives on the background
 * thread, whose listener calls the app's on the main thread through that
 * thread's `lynx`, so it's sent from there. Specs run on the main thread,
 * which comes back afterwards.
 */
const send = (env: TestingEnvironment, batch: object): void => {
  env.switchToBackgroundThread();
  try {
    env.backgroundThread.globalThis.lynx
      ?.getJSModule?.('GlobalEventEmitter')
      ?.emit(EVENT, [batch]);
  } finally {
    env.switchToMainThread();
  }
};

/**
 * The rotation matrix the shells send for an orientation, which `LynxMotion`
 * turns back into the angles: Rz(alpha) · Rx(beta) · Ry(gamma).
 */
const matrix = (alpha: number, beta: number, gamma: number): number[] => {
  const rad = Math.PI / 180;
  const [ca, sa] = [Math.cos(alpha * rad), Math.sin(alpha * rad)];
  const [cb, sb] = [Math.cos(beta * rad), Math.sin(beta * rad)];
  const [cg, sg] = [Math.cos(gamma * rad), Math.sin(gamma * rad)];
  return [
    ca * cg - sa * sb * sg,
    -cb * sa,
    ca * sg + cg * sa * sb,
    cg * sa + ca * sb * sg,
    ca * cb,
    sa * sg - ca * cg * sb,
    -cb * sg,
    sb,
    cb * cg,
  ];
};

/**
 * Sends a sample of the phone's motion sensors, as the shells do, to the
 * `LynxMotion` watches the app has: `watchAcceleration()`,
 * `watchRotation()` and `watchOrientation()`. A sensor nothing watches
 * isn't running, so its part reaches nobody, as on a phone. It arrives
 * through the background thread: wait for it with `waitForUpdate()`.
 *
 * @example
 * ```ts
 * await render(Level);
 * emitMotion({ orientation: { alpha: 0, beta: 0, gamma: 12 } });
 * await waitForUpdate();
 * expect(screen.getByText('12°')).toBeInTheDocument();
 * ```
 */
export const emitMotion = (motion: EmittedMotion): void => {
  const { env, module } = environment('emitMotion');
  const t = nextTime(module, motion.timestamp);
  const batch: Record<string, number[]> = {};
  if (motion.acceleration && module.running.has('acceleration')) {
    const { x, y, z } = motion.acceleration;
    batch['acceleration'] = [t, x, y, z];
  }
  if (motion.rotation && module.running.has('rotation')) {
    const { x, y, z } = motion.rotation;
    batch['rotation'] = [t, x, y, z];
  }
  if (motion.orientation && module.running.has('orientation')) {
    const { alpha, beta, gamma } = motion.orientation;
    batch['orientation'] = [t, ...matrix(alpha, beta, gamma)];
  }
  send(env, batch);
};

/**
 * Sends a compass heading, as the shells do, to the app's
 * `LynxMotion.watchHeading()` watches: degrees clockwise from magnetic
 * north, or an object with the true heading and the accuracy too (each
 * `null` unless it's given). Nothing arrives while nothing watches.
 *
 * @example
 * ```ts
 * setHeading(90);
 * await waitForUpdate();
 * expect(screen.getByText('E')).toBeInTheDocument();
 * ```
 */
export const setHeading = (heading: number | EmittedHeading): void => {
  const { env, module } = environment('setHeading');
  if (!module.running.has('heading')) return;
  const {
    magneticHeading,
    trueHeading = null,
    accuracy = null,
    timestamp,
  } = typeof heading === 'number' ? { magneticHeading: heading } : heading;
  send(env, {
    heading: [
      nextTime(module, timestamp),
      magneticHeading,
      trueHeading ?? -1,
      accuracy ?? -1,
    ],
  });
};

/**
 * Shakes the phone, as the person does, so the app's `LynxMotion.onShake()`
 * handlers run. The shells hear a shake themselves, so it arrives as one
 * event, not as accelerometer samples. Nothing happens while nothing listens.
 *
 * @example
 * ```ts
 * shakeDevice();
 * await waitForUpdate();
 * expect(screen.getByText('Undone')).toBeInTheDocument();
 * ```
 */
export const shakeDevice = (): void => {
  const { env, module } = environment('shakeDevice');
  if (!module.running.has('shake')) return;
  send(env, { shake: [nextTime(module)] });
};
