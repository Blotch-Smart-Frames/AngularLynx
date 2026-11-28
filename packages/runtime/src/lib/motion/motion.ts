import {
  DestroyRef,
  ErrorHandler,
  inject,
  Injectable,
  type Injector,
} from '@angular/core';
import { callOnBackground } from '../background-call';
import { LynxNativeModule } from '../native-module/native-module';
import type { PlatformType } from '../system-info/system-info';
import {
  headingFromOrientation,
  orientationFromMatrix,
  ShakeDetector,
} from './motion-math';

/**
 * The native module and global event of the apps `ng build --platform` makes
 * with angular.json's `motion` (`MotionModule.swift` and `MotionModule.kt` in
 * `packages/native/templates`).
 */
const MOTION_MODULE = 'AngularLynxMotion';
const MOTION_EVENT = 'angularLynxMotion';

/** What the shells can sample, as their module's `start` and `stop` name it. */
type Sensor = 'acceleration' | 'rotation' | 'orientation' | 'heading' | 'shake';

/**
 * The acceleration the phone measures, in m/s², along its own axes: x to the
 * right of the screen, y up it, z out of its face. Gravity is included, as
 * in `DeviceMotionEvent.accelerationIncludingGravity`, so a phone lying face
 * up reads about `{ x: 0, y: 0, z: 9.81 }` on every platform.
 */
export type LynxAcceleration = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** When it was measured, in milliseconds since the epoch, as `Date.now()`. */
  readonly timestamp: number;
};

/**
 * How fast the phone turns around each of its axes, in radians per second,
 * counterclockwise as seen from the axis's positive end (the right-hand
 * rule): the gyroscope, without its drift where the platform corrects it.
 */
export type LynxRotationRate = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** When it was measured, in milliseconds since the epoch. */
  readonly timestamp: number;
};

/**
 * Which way the phone faces, as `DeviceOrientationEvent` gives it, in
 * degrees: `beta` is its tilt forward and back (around x, -180 to 180),
 * `gamma` its tilt left and right (around y, -90 to 90), and `alpha` its turn
 * around z (0 to 360).
 *
 * `alpha` counts from wherever the phone faced when the sensors started, not
 * from north, as a non-absolute `DeviceOrientationEvent`'s does: neither
 * shell uses the compass for it, so it doesn't swing near a magnet. Read
 * north from {@link LynxMotion.watchHeading}. The web preview is the
 * exception in a browser that sends only absolute orientation: there,
 * `alpha` counts from north.
 */
export type LynxOrientation = {
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  /** When it was measured, in milliseconds since the epoch. */
  readonly timestamp: number;
};

/** Where the top of the phone points, from the compass. */
export type LynxHeading = {
  /** Degrees clockwise from magnetic north, 0 to 360. */
  readonly magneticHeading: number;
  /**
   * Degrees clockwise from true north, where the platform knows it: iOS
   * works it out when the app has location access, and gives `null`
   * otherwise. Android always gives `null`, since it needs the phone's
   * location to correct for the magnetic declination.
   */
  readonly trueHeading: number | null;
  /**
   * How far off the heading may be, in degrees, or `null` when the platform
   * doesn't say. A large value means the compass needs calibrating (moving
   * the phone in a figure eight).
   */
  readonly accuracy: number | null;
  /** When it was measured, in milliseconds since the epoch. */
  readonly timestamp: number;
};

/** Which sensors the phone has, as {@link LynxMotion.availability} reports. */
export type LynxMotionAvailability = {
  readonly acceleration: boolean;
  readonly rotation: boolean;
  readonly orientation: boolean;
  readonly heading: boolean;
};

/** How a `watch` method samples. */
export type LynxMotionOptions = {
  /**
   * The time between samples, in milliseconds: 16 (about 60 a second) unless
   * it's given, and at least 5. A target, not a guarantee: a sample up to a
   * quarter of it early (4 ms at most) still counts, for the sensor's jitter,
   * and the shells send samples in batches, so a handler can run a few times
   * in a row.
   * Every sample is work for the thread Angular runs on, so ask for no more
   * than the screen needs.
   */
  readonly interval?: number;
  /**
   * The injector whose destruction stops the watch, when it's called outside
   * an injection context.
   */
  readonly injector?: Injector;
};

/** What `onShake()` takes besides the handler. */
export type LynxShakeOptions = {
  /** The injector whose destruction stops listening, as for a watch. */
  readonly injector?: Injector;
};

/** The default time between samples, about one a frame. */
const DEFAULT_INTERVAL = 16;
/**
 * The shortest time between samples, 200 a second: Android 12 and later
 * limit apps to that without HIGH_SAMPLING_RATE_SENSORS, which the shells
 * don't declare.
 */
const MIN_INTERVAL = 5;

/**
 * What the shells' `angularLynxMotion` event carries: for each sensor that
 * sampled since the last event, its samples one after another in a flat
 * array, each starting with its time in milliseconds since the epoch. Flat
 * arrays of numbers are the cheapest to copy across the threads.
 *
 * - `acceleration`, `rotation`: `t, x, y, z`.
 * - `orientation`: `t` and the 9 entries of the rotation matrix
 *   orientationFromMatrix() reads.
 * - `heading`: `t, magnetic, true, accuracy`, the last two negative when
 *   unknown.
 * - `shake`: `t` for each shake.
 */
type MotionBatch = Partial<Record<Sensor, readonly number[]>>;

const STRIDES: Record<Exclude<Sensor, 'shake'>, number> = {
  acceleration: 4,
  rotation: 4,
  orientation: 10,
  heading: 4,
};

/** One `watch` call's handler and how often it wants samples. */
type Watcher<T> = {
  readonly interval: number;
  readonly handler: (sample: T) => void;
  /** When it was last called, by its sample's time. */
  last: number;
};

type Samples = {
  acceleration: LynxAcceleration;
  rotation: LynxRotationRate;
  orientation: LynxOrientation;
  heading: LynxHeading;
};

type GlobalEventEmitter = {
  addListener(name: string, listener: (batch?: MotionBatch) => void): unknown;
};

/** The part of a browser window the web preview's sensors use. */
type BrowserWindow = {
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
  readonly DeviceMotionEvent?: unknown;
  readonly DeviceOrientationEvent?: unknown;
};

/**
 * The page's window in Lynx for Web, or undefined elsewhere. Web-core runs
 * the main thread in a hidden iframe, and the browser sends the sensors'
 * events to the page around it, as `LynxHaptics` reaches it.
 */
const pageWindow = (): BrowserWindow | undefined => {
  if (
    typeof SystemInfo === 'undefined' ||
    (SystemInfo.platform as PlatformType) !== 'web'
  ) {
    return undefined;
  }
  const self = globalThis as unknown as { parent?: BrowserWindow };
  return self.parent ?? (self as unknown as BrowserWindow);
};

/**
 * Whether this runs under the testing library, whose environment keeps
 * itself in the `lynxTestingEnv` global: a spec that renders as the web
 * preview still hears the testing library's fake module, not a browser.
 */
const inTestingEnvironment = (): boolean =>
  (globalThis as { lynxTestingEnv?: unknown }).lynxTestingEnv !== undefined;

/**
 * The DestroyRef of whatever is being constructed, or null outside an
 * injection context. Angular has no public check for one, and `inject()`
 * throws outside it.
 */
const currentDestroyRef = (): DestroyRef | null => {
  try {
    return inject(DestroyRef);
  } catch {
    return null;
  }
};

/**
 * A watcher whose interval lets a sample at `t` through, and marks it.
 */
const due = <T>(watcher: Watcher<T>, t: number): boolean => {
  // A little early still counts: samples come with jitter, and one a hair
  // short of the interval would otherwise be skipped, halving the rate.
  if (t - watcher.last < watcher.interval - Math.min(4, watcher.interval / 4)) {
    return false;
  }
  watcher.last = t;
  return true;
};

const RADIANS = Math.PI / 180;

/**
 * The phone's motion sensors and compass, and its shakes: the accelerometer,
 * the gyroscope, the orientation the two make together, and the heading.
 * Lynx has no `DeviceMotionEvent` or `DeviceOrientationEvent`.
 *
 * - **iOS:** Core Motion's `CMMotionManager`, and `CLLocationManager`'s
 *   heading, which asks for no location permission.
 * - **Android:** `SensorManager`: the accelerometer, the gyroscope, the game
 *   rotation vector and, for the heading, the rotation vector.
 * - **Web preview:** the page's `devicemotion` and `deviceorientation`
 *   events. Safari on iOS sends them only once the page has asked with
 *   `DeviceMotionEvent.requestPermission()` from a tap, and desktop browsers
 *   send none.
 * - **Lynx Explorer:** none of them, as a phone without the sensors.
 *
 * Each sample reaches the thread Angular runs on, so the shells sample at
 * the rate asked for and send what they gathered at most once a frame, and
 * hear shakes themselves. The sensors run only while something watches, and
 * stop while the app is in the background.
 *
 * The native module is only in apps whose angular.json build options set
 * `"motion": true`. Without it, nothing is ever sampled, and
 * {@link availability} reports no sensors. None of the sensors here needs a
 * permission.
 *
 * Under the testing library, `emitMotion()`, `setHeading()` and
 * `shakeDevice()` send the samples.
 *
 * @usageNotes
 * ```typescript
 * export class Level {
 *   readonly #motion = inject(LynxMotion);
 *   readonly tilt = signal(0);
 *
 *   constructor() {
 *     // Stops when the component is destroyed.
 *     this.#motion.watchOrientation({ interval: 50 }, ({ gamma }) =>
 *       this.tilt.set(gamma),
 *     );
 *     this.#motion.onShake(() => this.undo());
 *   }
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxMotion {
  readonly #errorHandler = inject(ErrorHandler);
  readonly #modules = inject(LynxNativeModule);
  readonly #watchers: {
    [S in keyof Samples]: Set<Watcher<Samples[S]>>;
  } = {
    acceleration: new Set(),
    rotation: new Set(),
    orientation: new Set(),
    heading: new Set(),
  };
  readonly #shakeHandlers = new Set<() => void>();
  /** The interval each sensor runs at, for those running. */
  readonly #running = new Map<Sensor, number>();
  /** Whether the global event has a listener yet. */
  #listening = false;
  /** The web preview's listeners, while they're added. */
  #web?: { remove(): void };
  /** The app is gone, so nothing may start a sensor again. */
  #destroyed = false;

  constructor() {
    // The app is gone: nothing should keep the sensors on for it.
    inject(DestroyRef).onDestroy(() => {
      // A watch made outside an injection context outlives the app, and
      // stopping one would otherwise start the sensor again for the others.
      this.#destroyed = true;
      for (const watchers of Object.values(this.#watchers)) watchers.clear();
      this.#shakeHandlers.clear();
      // A Map carries on past the entries deleted as it goes.
      for (const sensor of this.#running.keys()) this.#stop(sensor);
      this.#web?.remove();
    });
  }

  /**
   * Calls `handler` with the acceleration the phone measures, gravity
   * included, about every `interval` milliseconds, until the function it
   * returns is called or the component or service it was called from is
   * destroyed.
   */
  watchAcceleration(handler: (sample: LynxAcceleration) => void): () => void;
  watchAcceleration(
    options: LynxMotionOptions,
    handler: (sample: LynxAcceleration) => void,
  ): () => void;
  watchAcceleration(...args: WatchArgs<LynxAcceleration>): () => void {
    return this.#watch('acceleration', ...watchArgs(args));
  }

  /**
   * Calls `handler` with how fast the phone turns around each axis, about
   * every `interval` milliseconds, until the function it returns is called
   * or the caller is destroyed.
   */
  watchRotation(handler: (sample: LynxRotationRate) => void): () => void;
  watchRotation(
    options: LynxMotionOptions,
    handler: (sample: LynxRotationRate) => void,
  ): () => void;
  watchRotation(...args: WatchArgs<LynxRotationRate>): () => void {
    return this.#watch('rotation', ...watchArgs(args));
  }

  /**
   * Calls `handler` with which way the phone faces (`alpha`, `beta`,
   * `gamma`), about every `interval` milliseconds, until the function it
   * returns is called or the caller is destroyed.
   */
  watchOrientation(handler: (sample: LynxOrientation) => void): () => void;
  watchOrientation(
    options: LynxMotionOptions,
    handler: (sample: LynxOrientation) => void,
  ): () => void;
  watchOrientation(...args: WatchArgs<LynxOrientation>): () => void {
    return this.#watch('orientation', ...watchArgs(args));
  }

  /**
   * Calls `handler` with where the top of the phone points, from the
   * compass, about every `interval` milliseconds, until the function it
   * returns is called or the caller is destroyed. iOS reports a heading as
   * it changes by a degree or more, so a phone held still may be quiet.
   */
  watchHeading(handler: (sample: LynxHeading) => void): () => void;
  watchHeading(
    options: LynxMotionOptions,
    handler: (sample: LynxHeading) => void,
  ): () => void;
  watchHeading(...args: WatchArgs<LynxHeading>): () => void {
    return this.#watch('heading', ...watchArgs(args));
  }

  /**
   * Calls `handler` each time the person shakes the phone, until the
   * function it returns is called or the caller is destroyed. The shells
   * hear shakes from the accelerometer themselves (a sharp, repeated
   * movement for a quarter of a second or more, not walking or setting the
   * phone down), so listening costs the thread Angular runs on nothing until
   * one comes.
   */
  onShake(handler: () => void, options?: LynxShakeOptions): () => void {
    const entry = () => handler();
    this.#shakeHandlers.add(entry);
    const remove = this.#tieToDestroy(options?.injector, () => {
      this.#shakeHandlers.delete(entry);
      this.#update('shake');
    });
    this.#update('shake');
    return remove;
  }

  /**
   * Which sensors the phone has. Resolves with none in Lynx Explorer, in an
   * app built without angular.json's `motion`, and on the iOS Simulator,
   * which has no motion sensors. The web preview can't tell, and reports
   * what the browser has events for.
   */
  async availability(): Promise<LynxMotionAvailability> {
    const none = {
      acceleration: false,
      rotation: false,
      orientation: false,
      heading: false,
    };
    const page = inTestingEnvironment() ? undefined : pageWindow();
    if (page) {
      const motion = page.DeviceMotionEvent !== undefined;
      const orientation = page.DeviceOrientationEvent !== undefined;
      return {
        acceleration: motion,
        rotation: motion,
        orientation,
        heading: orientation,
      };
    }
    try {
      const answer = (await callOnBackground(
        'callNativeModuleAsync',
        MOTION_MODULE,
        'availability',
        [],
      )) as Partial<LynxMotionAvailability> | undefined;
      return {
        acceleration: answer?.acceleration === true,
        rotation: answer?.rotation === true,
        orientation: answer?.orientation === true,
        heading: answer?.heading === true,
      };
    } catch {
      return none;
    }
  }

  #watch<S extends keyof Samples>(
    sensor: S,
    options: LynxMotionOptions,
    handler: (sample: Samples[S]) => void,
  ): () => void {
    const interval = Math.max(
      MIN_INTERVAL,
      Number.isFinite(options.interval)
        ? (options.interval as number)
        : DEFAULT_INTERVAL,
    );
    const watcher: Watcher<Samples[S]> = {
      interval,
      handler,
      last: -Infinity,
    };
    const watchers = this.#watchers[sensor] as Set<Watcher<Samples[S]>>;
    watchers.add(watcher);
    const remove = this.#tieToDestroy(options.injector, () => {
      watchers.delete(watcher);
      this.#update(sensor);
    });
    this.#update(sensor);
    return remove;
  }

  /**
   * Removes a watch when its injector goes, or sooner by hand. Removed by
   * hand, it also leaves the DestroyRef, which would otherwise keep the
   * handler, and what it holds, until a long-lived injector goes. Removing
   * twice is harmless.
   */
  #tieToDestroy(injector: Injector | undefined, drop: () => void): () => void {
    let dropped = false;
    const once = () => {
      if (dropped) return;
      dropped = true;
      drop();
    };
    const unregister = (
      injector?.get(DestroyRef) ?? currentDestroyRef()
    )?.onDestroy(once);
    return () => {
      unregister?.();
      once();
    };
  }

  /**
   * Starts, restarts or stops a sensor for the watchers it has now: it runs
   * at the shortest interval any of them asked for.
   */
  #update(sensor: Sensor): void {
    if (this.#destroyed) return;
    let interval: number | undefined;
    if (sensor === 'shake') {
      interval = this.#shakeHandlers.size > 0 ? 0 : undefined;
    } else {
      for (const watcher of this.#watchers[sensor]) {
        interval = Math.min(interval ?? Infinity, watcher.interval);
      }
    }
    const running = this.#running.get(sensor);
    if (interval === running) return;
    if (interval === undefined) {
      this.#stop(sensor);
      return;
    }
    this.#running.set(sensor, interval);
    const page = inTestingEnvironment() ? undefined : pageWindow();
    if (page) {
      this.#listenOnWeb(page);
      return;
    }
    this.#listen();
    callOnBackground('callModule', 'native', MOTION_MODULE, 'start', [
      sensor,
      interval,
    ]).catch(() => {
      // A host without the module (Lynx Explorer, an app built without
      // `motion`) never samples: the watch just stays quiet.
    });
  }

  #stop(sensor: Sensor): void {
    this.#running.delete(sensor);
    if (this.#web) {
      if (this.#running.size === 0) {
        this.#web.remove();
        this.#web = undefined;
      }
      return;
    }
    callOnBackground('callModule', 'native', MOTION_MODULE, 'stop', [
      sensor,
    ]).catch(() => {
      // Nothing to stop without the module.
    });
  }

  /**
   * Listens for the shells' event, once. On the main thread, where Angular
   * runs, the emitter is a proxy whose calls go through the background
   * thread, and the listener is called back with the batch copied as JSON.
   */
  #listen(): void {
    if (this.#listening) return;
    this.#listening = true;
    const emitter =
      this.#modules.getJSModule<GlobalEventEmitter>('GlobalEventEmitter');
    Promise.resolve()
      .then(() =>
        emitter?.addListener(MOTION_EVENT, (batch) => this.#receive(batch)),
      )
      .catch(() => {
        // Without a background thread there are no global events to hear.
      });
  }

  /**
   * Hands a batch from the shells to the watchers.
   */
  #receive(batch: MotionBatch | undefined): void {
    if (!batch) return;
    this.#each(batch.acceleration, STRIDES.acceleration, (s, i) =>
      this.#emit('acceleration', s[i]!, () => ({
        x: s[i + 1]!,
        y: s[i + 2]!,
        z: s[i + 3]!,
        timestamp: s[i]!,
      })),
    );
    this.#each(batch.rotation, STRIDES.rotation, (s, i) =>
      this.#emit('rotation', s[i]!, () => ({
        x: s[i + 1]!,
        y: s[i + 2]!,
        z: s[i + 3]!,
        timestamp: s[i]!,
      })),
    );
    this.#each(batch.orientation, STRIDES.orientation, (s, i) =>
      this.#emit('orientation', s[i]!, () => ({
        ...orientationFromMatrix(s, i + 1),
        timestamp: s[i]!,
      })),
    );
    this.#each(batch.heading, STRIDES.heading, (s, i) =>
      this.#emit('heading', s[i]!, () => ({
        magneticHeading: s[i + 1]!,
        trueHeading: s[i + 2]! >= 0 ? s[i + 2]! : null,
        accuracy: s[i + 3]! >= 0 ? s[i + 3]! : null,
        timestamp: s[i]!,
      })),
    );
    for (const _ of Array.isArray(batch.shake) ? batch.shake : []) {
      this.#shake();
    }
  }

  #each(
    samples: readonly number[] | undefined,
    stride: number,
    read: (samples: readonly number[], index: number) => void,
  ): void {
    if (!Array.isArray(samples)) return;
    for (let i = 0; i + stride <= samples.length; i += stride) {
      read(samples, i);
    }
  }

  /**
   * Calls each watcher of `sensor` whose interval has passed, making the
   * sample only if one wants it.
   */
  #emit<S extends keyof Samples>(
    sensor: S,
    t: number,
    make: () => Samples[S],
  ): void {
    let sample: Samples[S] | undefined;
    // A handler may stop its own watch as it's called: a Set skips what was
    // removed and carries on.
    for (const watcher of this.#watchers[sensor] as Set<Watcher<Samples[S]>>) {
      if (!due(watcher, t)) continue;
      sample ??= make();
      try {
        watcher.handler(sample);
      } catch (error) {
        this.#errorHandler.handleError(error);
      }
    }
  }

  #shake(): void {
    for (const handler of this.#shakeHandlers) {
      try {
        handler();
      } catch (error) {
        this.#errorHandler.handleError(error);
      }
    }
  }

  /**
   * The web preview: listens to the page's sensor events while anything
   * watches, and runs the shake detector on its motion.
   */
  #listenOnWeb(page: BrowserWindow): void {
    if (this.#web) return;
    const shakes = new ShakeDetector();
    const onMotion = (event: any): void => {
      const t = Date.now();
      const a = event?.accelerationIncludingGravity;
      if (numbers(a?.x, a?.y, a?.z)) {
        this.#emit('acceleration', t, () => ({
          x: a.x,
          y: a.y,
          z: a.z,
          timestamp: t,
        }));
        if (this.#running.has('shake') && shakes.add(t, a.x, a.y, a.z)) {
          this.#shake();
        }
      }
      // The web gives degrees a second, as alpha around z, beta around x and
      // gamma around y.
      const r = event?.rotationRate;
      if (numbers(r?.alpha, r?.beta, r?.gamma)) {
        this.#emit('rotation', t, () => ({
          x: r.beta * RADIANS,
          y: r.gamma * RADIANS,
          z: r.alpha * RADIANS,
          timestamp: t,
        }));
      }
    };
    const onOrientation = (event: any): void => {
      const t = Date.now();
      // Most browsers send this relative to where the phone faced at the
      // start, as the shells do, and absolute orientation as its own event.
      // A browser without the relative one sends the absolute one here
      // (absolute: true), whose alpha counts from north: still the phone's
      // orientation, which a watch gets rather than nothing.
      if (numbers(event?.alpha, event?.beta, event?.gamma)) {
        this.#emit('orientation', t, () => ({
          alpha: event.alpha,
          beta: event.beta,
          gamma: event.gamma,
          timestamp: t,
        }));
      }
      // Safari gives the compass as webkitCompassHeading, already clockwise
      // from magnetic north, and a negative one when it has no direction.
      if (
        typeof event?.webkitCompassHeading === 'number' &&
        event.webkitCompassHeading >= 0
      ) {
        this.#emit('heading', t, () => ({
          magneticHeading: event.webkitCompassHeading,
          trueHeading: null,
          accuracy:
            event.webkitCompassAccuracy >= 0
              ? event.webkitCompassAccuracy
              : null,
          timestamp: t,
        }));
      }
    };
    /**
     * Chrome gives the compass as an absolute orientation. The heading is
     * where the top of the phone points: the phone's y axis turned into the
     * earth's frame (east, north), as Android's getOrientation() reads its
     * azimuth. alpha alone is it only while the phone lies flat: tipped past
     * upright, the top points the other way.
     */
    const onAbsolute = (event: any): void => {
      if (!numbers(event?.alpha, event?.beta, event?.gamma)) return;
      const t = Date.now();
      this.#emit('heading', t, () => ({
        magneticHeading: headingFromOrientation(
          event.alpha,
          event.beta,
          event.gamma,
        ),
        trueHeading: null,
        accuracy: null,
        timestamp: t,
      }));
    };
    page.addEventListener('devicemotion', onMotion);
    page.addEventListener('deviceorientation', onOrientation);
    page.addEventListener('deviceorientationabsolute', onAbsolute);
    this.#web = {
      remove: () => {
        page.removeEventListener('devicemotion', onMotion);
        page.removeEventListener('deviceorientation', onOrientation);
        page.removeEventListener('deviceorientationabsolute', onAbsolute);
      },
    };
  }
}

/**
 * Whether each value is a number. A browser's sensor event can leave any of
 * its readings null, and a sample promises numbers.
 */
const numbers = (...values: unknown[]): boolean =>
  values.every((value) => typeof value === 'number' && Number.isFinite(value));

type WatchArgs<T> =
  | [handler: (sample: T) => void]
  | [options: LynxMotionOptions, handler: (sample: T) => void];

/**
 * The options and handler of a `watch` call, with or without options.
 */
const watchArgs = <T>(
  args: WatchArgs<T>,
): [LynxMotionOptions, (sample: T) => void] =>
  args.length === 1 ? [{}, args[0]] : [args[0] ?? {}, args[1]];
