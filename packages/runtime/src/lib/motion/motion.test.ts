import '@angular/compiler';
import {
  createEnvironmentInjector,
  ErrorHandler,
  type EnvironmentInjector,
  Injector,
} from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxNativeModule } from '../native-module/native-module';
import { LynxMotion } from './motion';
import { matrixFromOrientation } from './motion-math';

const EVENT = 'angularLynxMotion';

const createMotion = (errorHandler?: ErrorHandler) => {
  const injector = Injector.create({
    providers: [
      LynxMotion,
      LynxNativeModule,
      { provide: ErrorHandler, useValue: errorHandler ?? new ErrorHandler() },
    ],
  });
  return { motion: injector.get(LynxMotion), injector };
};

/**
 * Stands in for the shells' AngularLynxMotion module and the global event it
 * sends, as the background thread sees them. Unit tests run as the
 * background thread, so the service calls both directly. `send` sends a
 * batch as the shell does.
 */
const stubShell = (
  availability: object = {
    acceleration: true,
    rotation: true,
    orientation: true,
    heading: true,
  },
) => {
  const listeners: ((batch: unknown) => void)[] = [];
  const module = {
    start: vi.fn(),
    stop: vi.fn(),
    availability: vi.fn((done: (result: object) => void) => done(availability)),
  };
  vi.stubGlobal('NativeModules', { AngularLynxMotion: module });
  vi.stubGlobal('lynx', {
    getJSModule: (name: string) =>
      name === 'GlobalEventEmitter'
        ? {
            addListener: (event: string, listener: (b: unknown) => void) => {
              if (event === EVENT) listeners.push(listener);
            },
          }
        : undefined,
  });
  return {
    module,
    listeners,
    send: (batch: object) => listeners.forEach((listener) => listener(batch)),
  };
};

/**
 * Lets the listener the service adds after a microtask be added.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LynxMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts the accelerometer at the interval asked for, and hands over its samples', async () => {
    const shell = stubShell();
    const { motion } = createMotion();
    const samples: unknown[] = [];
    motion.watchAcceleration({ interval: 50 }, (sample) =>
      samples.push(sample),
    );
    await settle();
    expect(shell.module.start).toHaveBeenCalledWith('acceleration', 50);

    shell.send({ acceleration: [1000, 0.1, 0.2, 9.8, 1050, 0.3, 0.4, 9.7] });
    expect(samples).toEqual([
      { x: 0.1, y: 0.2, z: 9.8, timestamp: 1000 },
      { x: 0.3, y: 0.4, z: 9.7, timestamp: 1050 },
    ]);
  });

  it('starts at 16 ms without an interval, and never below 5 ms', async () => {
    const shell = stubShell();
    const { motion } = createMotion();
    const stop = motion.watchRotation(() => undefined);
    expect(shell.module.start).toHaveBeenLastCalledWith('rotation', 16);
    motion.watchRotation({ interval: 1 }, () => undefined);
    expect(shell.module.start).toHaveBeenLastCalledWith('rotation', 5);
    stop();
    // The other watch keeps the sensor at its own interval.
    expect(shell.module.stop).not.toHaveBeenCalled();
    motion.watchHeading({ interval: Number.NaN }, () => undefined);
    expect(shell.module.start).toHaveBeenLastCalledWith('heading', 16);
  });

  it('runs a sensor at the shortest interval watched, and calls each watcher at its own', async () => {
    const shell = stubShell();
    const { motion } = createMotion();
    const fast: number[] = [];
    const slow: number[] = [];
    const stopFast = motion.watchRotation({ interval: 20 }, ({ timestamp }) =>
      fast.push(timestamp),
    );
    const stopSlow = motion.watchRotation({ interval: 60 }, ({ timestamp }) =>
      slow.push(timestamp),
    );
    await settle();
    expect(shell.module.start).toHaveBeenLastCalledWith('rotation', 20);

    // Samples with jitter: one a little early still counts.
    const times = [0, 20, 39, 60, 80, 100, 121];
    shell.send({ rotation: times.flatMap((t) => [t, 0, 0, 1]) });
    expect(fast).toEqual(times);
    expect(slow).toEqual([0, 60, 121]);

    stopFast();
    expect(shell.module.start).toHaveBeenLastCalledWith('rotation', 60);
    stopSlow();
    expect(shell.module.stop).toHaveBeenCalledWith('rotation');
    // Stopping twice is harmless.
    stopSlow();
    expect(shell.module.stop).toHaveBeenCalledTimes(1);
  });

  it("gives the orientation as DeviceOrientationEvent's angles, from the shell's rotation matrix", async () => {
    const shell = stubShell();
    const { motion } = createMotion();
    const samples: { alpha: number; beta: number; gamma: number }[] = [];
    motion.watchOrientation((sample) => samples.push(sample));
    await settle();
    shell.send({
      orientation: [
        5,
        ...matrixFromOrientation(30, 45, -20),
        30,
        ...matrixFromOrientation(0, 0, 0),
      ],
    });
    expect(samples[0]!.alpha).toBeCloseTo(30);
    expect(samples[0]!.beta).toBeCloseTo(45);
    expect(samples[0]!.gamma).toBeCloseTo(-20);
    expect(samples[1]).toEqual({ alpha: 0, beta: 0, gamma: 0, timestamp: 30 });
  });

  it('gives null for a heading the shell sends as unknown', async () => {
    const shell = stubShell();
    const { motion } = createMotion();
    const samples: unknown[] = [];
    motion.watchHeading((sample) => samples.push(sample));
    await settle();
    shell.send({ heading: [1, 90, -1, -1, 40, 180.5, 182, 5] });
    expect(samples).toEqual([
      { magneticHeading: 90, trueHeading: null, accuracy: null, timestamp: 1 },
      { magneticHeading: 180.5, trueHeading: 182, accuracy: 5, timestamp: 40 },
    ]);
  });

  it('ignores what a batch has no watcher for, a short sample, and a batch of nothing', async () => {
    const shell = stubShell();
    const { motion } = createMotion();
    const samples: unknown[] = [];
    motion.watchAcceleration((sample) => samples.push(sample));
    await settle();
    shell.send({ acceleration: [0, 1, 2], rotation: [0, 1, 2, 3] });
    shell.listeners[0]!(undefined);
    shell.send({ acceleration: 'nonsense', shake: 'nonsense' });
    expect(samples).toEqual([]);
  });

  it('hears shakes from the shell, and stops listening once nothing does', async () => {
    const shell = stubShell();
    const { motion } = createMotion();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = motion.onShake(first);
    motion.onShake(second);
    await settle();
    expect(shell.module.start).toHaveBeenCalledTimes(1);
    expect(shell.module.start).toHaveBeenCalledWith('shake', 0);

    shell.send({ shake: [100, 900] });
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);

    stopFirst();
    shell.send({ shake: [1700] });
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(3);
    expect(shell.module.stop).not.toHaveBeenCalled();
  });

  it("hands a handler's error to the ErrorHandler and calls the others", async () => {
    const shell = stubShell();
    const handleError = vi.fn();
    const { motion } = createMotion({ handleError } as ErrorHandler);
    const after = vi.fn();
    motion.onShake(() => {
      throw new Error('shake');
    });
    motion.onShake(after);
    motion.watchAcceleration(() => {
      throw new Error('sample');
    });
    await settle();
    shell.send({ shake: [1], acceleration: [1, 0, 0, 0] });
    expect(after).toHaveBeenCalledOnce();
    expect(handleError).toHaveBeenCalledTimes(2);
  });

  it('stops a watch when the injector it belongs to is destroyed', async () => {
    const shell = stubShell();
    const { motion, injector } = createMotion();
    const child: EnvironmentInjector = createEnvironmentInjector(
      [],
      injector as EnvironmentInjector,
    );
    const handler = vi.fn();
    motion.watchAcceleration({ injector: child }, handler);
    motion.onShake(handler, { injector: child });
    child.destroy();
    expect(shell.module.stop).toHaveBeenCalledWith('acceleration');
    expect(shell.module.stop).toHaveBeenCalledWith('shake');
  });

  it('stops every sensor when the app is destroyed', async () => {
    const shell = stubShell();
    const { motion, injector } = createMotion();
    motion.watchAcceleration(() => undefined);
    motion.watchHeading(() => undefined);
    (injector as unknown as { destroy(): void }).destroy();
    expect(shell.module.stop).toHaveBeenCalledWith('acceleration');
    expect(shell.module.stop).toHaveBeenCalledWith('heading');
  });

  // Watches made outside an injection context outlive the app.
  it("doesn't start a sensor again when a watch stops after the app is destroyed", async () => {
    const shell = stubShell();
    const { motion, injector } = createMotion();
    const stopFirst = motion.watchAcceleration(
      { interval: 20 },
      () => undefined,
    );
    motion.watchAcceleration({ interval: 50 }, () => undefined);
    const stopShake = motion.onShake(() => undefined);
    motion.onShake(() => undefined);
    (injector as unknown as { destroy(): void }).destroy();
    shell.module.start.mockClear();
    stopFirst();
    stopShake();
    motion.watchRotation(() => undefined);
    expect(shell.module.start).not.toHaveBeenCalled();
  });

  it('reports the sensors the shell has', async () => {
    stubShell({ acceleration: true, rotation: false, heading: true });
    await expect(createMotion().motion.availability()).resolves.toEqual({
      acceleration: true,
      rotation: false,
      orientation: false,
      heading: true,
    });
  });

  // Lynx Explorer, and an app built without angular.json's motion.
  it('reports no sensors, and never throws, without the module', async () => {
    vi.stubGlobal('NativeModules', {});
    const { motion } = createMotion();
    await expect(motion.availability()).resolves.toEqual({
      acceleration: false,
      rotation: false,
      orientation: false,
      heading: false,
    });
    const stop = motion.watchAcceleration(() => undefined);
    await settle();
    stop();
    await settle();
  });

  it('takes options left out of a watch as none', async () => {
    const shell = stubShell();
    createMotion().motion.watchAcceleration(
      undefined as unknown as object,
      () => undefined,
    );
    expect(shell.module.start).toHaveBeenCalledWith('acceleration', 16);
  });

  it("carries on when the shell's event can't be listened to", async () => {
    vi.stubGlobal('NativeModules', {});
    vi.stubGlobal('lynx', {
      getJSModule: () => ({
        addListener: () => {
          throw new Error('No background thread');
        },
      }),
    });
    createMotion().motion.onShake(() => undefined);
    await settle();
  });

  // A spec that renders as the web preview hears the testing library's
  // module, as on a phone, not the browser's events.
  it('uses the native module under the testing library, even as the web preview', async () => {
    const shell = stubShell();
    vi.stubGlobal('SystemInfo', { platform: 'web' });
    vi.stubGlobal('lynxTestingEnv', {});
    const { motion } = createMotion();
    motion.watchAcceleration(() => undefined);
    expect(shell.module.start).toHaveBeenCalledWith('acceleration', 16);
    await expect(motion.availability()).resolves.toEqual({
      acceleration: true,
      rotation: true,
      orientation: true,
      heading: true,
    });
  });

  describe('in the web preview', () => {
    const stubPage = () => {
      const listeners = new Map<string, Set<(event: object) => void>>();
      const page = {
        DeviceMotionEvent: class {},
        DeviceOrientationEvent: class {},
        addEventListener: (type: string, listener: (event: object) => void) => {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(listener);
        },
        removeEventListener: (
          type: string,
          listener: (event: object) => void,
        ) => listeners.get(type)?.delete(listener),
      };
      vi.stubGlobal('SystemInfo', { platform: 'web' });
      vi.stubGlobal('parent', page);
      const module = { start: vi.fn(), stop: vi.fn() };
      vi.stubGlobal('NativeModules', { AngularLynxMotion: module });
      return {
        module,
        listeners,
        fire: (type: string, event: object) =>
          listeners.get(type)?.forEach((listener) => listener(event)),
      };
    };

    it("reads the page's sensor events, and removes them once nothing watches", () => {
      const page = stubPage();
      vi.spyOn(Date, 'now').mockReturnValue(1000);
      const { motion } = createMotion();
      const acceleration = vi.fn();
      const rotation = vi.fn();
      const orientation = vi.fn();
      const heading = vi.fn();
      const stops = [
        motion.watchAcceleration(acceleration),
        motion.watchRotation(rotation),
        motion.watchOrientation(orientation),
        motion.watchHeading(heading),
      ];
      // The page's events, not the shell's module.
      expect(page.module.start).not.toHaveBeenCalled();

      page.fire('devicemotion', {
        accelerationIncludingGravity: { x: 1, y: 2, z: 9 },
        rotationRate: { alpha: 180, beta: 90, gamma: -90 },
      });
      expect(acceleration).toHaveBeenCalledWith({
        x: 1,
        y: 2,
        z: 9,
        timestamp: 1000,
      });
      const rate = rotation.mock.calls[0]![0];
      expect(rate.x).toBeCloseTo(Math.PI / 2);
      expect(rate.y).toBeCloseTo(-Math.PI / 2);
      expect(rate.z).toBeCloseTo(Math.PI);

      page.fire('deviceorientation', {
        alpha: 10,
        beta: 20,
        gamma: 30,
        absolute: false,
        webkitCompassHeading: 270,
        webkitCompassAccuracy: 10,
      });
      expect(orientation).toHaveBeenCalledWith({
        alpha: 10,
        beta: 20,
        gamma: 30,
        timestamp: 1000,
      });
      expect(heading).toHaveBeenLastCalledWith({
        magneticHeading: 270,
        trueHeading: null,
        accuracy: 10,
        timestamp: 1000,
      });

      vi.spyOn(Date, 'now').mockReturnValue(2000);
      page.fire('deviceorientationabsolute', { alpha: 90, beta: 0, gamma: 0 });
      expect(heading).toHaveBeenLastCalledWith({
        magneticHeading: 270,
        trueHeading: null,
        accuracy: null,
        timestamp: 2000,
      });
      // Events without readings are left alone.
      page.fire('devicemotion', {});
      // A browser can leave any reading null: a sample promises numbers.
      page.fire('devicemotion', {
        accelerationIncludingGravity: { x: 1, y: null, z: 9 },
        rotationRate: { alpha: 1, beta: null, gamma: 1 },
      });
      page.fire('deviceorientation', { alpha: 30, beta: null, gamma: null });
      page.fire('deviceorientationabsolute', {
        alpha: 30,
        beta: null,
        gamma: 0,
      });
      page.fire('deviceorientation', { alpha: null });
      // Safari's accuracy is -1 while the compass is uncalibrated.
      vi.spyOn(Date, 'now').mockReturnValue(3000);
      page.fire('deviceorientation', {
        alpha: null,
        webkitCompassHeading: 12,
        webkitCompassAccuracy: -1,
      });
      expect(heading).toHaveBeenLastCalledWith({
        magneticHeading: 12,
        trueHeading: null,
        accuracy: null,
        timestamp: 3000,
      });
      page.fire('deviceorientationabsolute', { alpha: null });
      // Safari's heading is negative when it has no direction.
      vi.spyOn(Date, 'now').mockReturnValue(4000);
      page.fire('deviceorientation', { alpha: null, webkitCompassHeading: -1 });
      expect(acceleration).toHaveBeenCalledOnce();
      expect(heading).toHaveBeenCalledTimes(3);

      // A browser that sends only absolute orientation sends it here too.
      page.fire('deviceorientation', {
        alpha: 300,
        beta: 1,
        gamma: 2,
        absolute: true,
      });
      expect(orientation).toHaveBeenLastCalledWith({
        alpha: 300,
        beta: 1,
        gamma: 2,
        timestamp: 4000,
      });

      stops.forEach((stop) => stop());
      expect([...page.listeners.values()].every((set) => set.size === 0)).toBe(
        true,
      );
    });

    it("hears a shake in the page's motion", () => {
      const page = stubPage();
      let now = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const { motion } = createMotion();
      const shaken = vi.fn();
      motion.onShake(shaken);
      for (; now <= 400; now += 20) {
        page.fire('devicemotion', {
          accelerationIncludingGravity: { x: now % 40 ? 20 : -20, y: 0, z: 9 },
        });
      }
      expect(shaken).toHaveBeenCalledOnce();
    });

    it('reports nothing in a browser without the events', async () => {
      vi.stubGlobal('SystemInfo', { platform: 'web' });
      vi.stubGlobal('parent', undefined);
      await expect(createMotion().motion.availability()).resolves.toEqual({
        acceleration: false,
        rotation: false,
        orientation: false,
        heading: false,
      });
    });

    it('reports what the browser has events for', async () => {
      stubPage();
      await expect(createMotion().motion.availability()).resolves.toEqual({
        acceleration: true,
        rotation: true,
        orientation: true,
        heading: true,
      });
    });
  });
});
