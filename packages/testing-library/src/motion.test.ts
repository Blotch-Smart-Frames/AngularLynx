/**
 * LynxMotion under the testing library: the setup gives the environment's
 * background thread an AngularLynxMotion module standing for a phone with
 * every sensor, and emitMotion(), setHeading() and shakeDevice() send its
 * samples through it as the shells do.
 */

import { Component, inject, signal } from '@angular/core';
import { LYNX_ELEMENTS, LynxMotion } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import {
  emitMotion,
  render,
  screen,
  setHeading,
  shakeDevice,
  waitForUpdate,
} from './index.js';
import { installMotionModule } from './motion.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'motion-readout',
  imports: [LYNX_ELEMENTS],
  template: `
    <text>Gravity {{ gravity() }}</text>
    <text>Spin {{ spin() }}</text>
    <text>Tilt {{ tilt() }}</text>
    <text>Heading {{ heading() }}</text>
    <text>Shakes {{ shakes() }}</text>
    <text>Sensors {{ sensors() }}</text>
  `,
})
class Readout {
  readonly #motion = inject(LynxMotion);
  readonly gravity = signal('none');
  readonly spin = signal('none');
  readonly tilt = signal('none');
  readonly heading = signal('none');
  readonly shakes = signal(0);
  readonly sensors = signal('…');
  readonly stopTilt: () => void;

  constructor() {
    this.#motion.watchAcceleration({ interval: 100 }, ({ z }) =>
      this.gravity.set(z.toFixed(1)),
    );
    this.#motion.watchRotation(({ z }) => this.spin.set(z.toFixed(1)));
    this.stopTilt = this.#motion.watchOrientation(({ beta, gamma }) =>
      this.tilt.set(`${Math.round(beta)},${Math.round(gamma)}`),
    );
    this.#motion.watchHeading(({ magneticHeading, trueHeading, accuracy }) =>
      this.heading.set(`${magneticHeading} ${trueHeading} ${accuracy}`),
    );
    this.#motion.onShake(() => this.shakes.update((count) => count + 1));
    void this.#motion
      .availability()
      .then((available) =>
        this.sensors.set(
          Object.values(available).every(Boolean) ? 'all' : 'some',
        ),
      );
  }
}

describe('LynxMotion under the testing library', () => {
  it("hands the app the samples a spec sends, through the shells' event", async () => {
    await render(Readout);
    await settle();
    expect(screen.getByText('Sensors all')).toBeInTheDocument();

    emitMotion({
      acceleration: { x: 0, y: 0, z: 9.81 },
      rotation: { x: 0, y: 0, z: 1.5 },
      orientation: { alpha: 10, beta: 30, gamma: -20 },
    });
    await settle();
    expect(screen.getByText('Gravity 9.8')).toBeInTheDocument();
    expect(screen.getByText('Spin 1.5')).toBeInTheDocument();
    expect(screen.getByText('Tilt 30,-20')).toBeInTheDocument();

    // The next sample comes a second later, past every watch's interval.
    emitMotion({ acceleration: { x: 0, y: 0, z: -9.81 } });
    await settle();
    expect(screen.getByText('Gravity -9.8')).toBeInTheDocument();

    setHeading(90);
    await settle();
    expect(screen.getByText('Heading 90 null null')).toBeInTheDocument();
    setHeading({ magneticHeading: 180, trueHeading: 182, accuracy: 5 });
    await settle();
    expect(screen.getByText('Heading 180 182 5')).toBeInTheDocument();

    shakeDevice();
    shakeDevice();
    await settle();
    expect(screen.getByText('Shakes 2')).toBeInTheDocument();
  });

  it("sends nothing for a sensor the app doesn't watch", async () => {
    const { componentRef } = await render(Readout);
    await settle();
    componentRef.instance.stopTilt();
    await settle();
    emitMotion({ orientation: { alpha: 0, beta: 45, gamma: 0 } });
    await settle();
    expect(screen.getByText('Tilt none')).toBeInTheDocument();
  });

  it('takes a sample too soon for a watch as the phone does: it skips it', async () => {
    await render(Readout);
    await settle();
    emitMotion({ acceleration: { x: 0, y: 0, z: 1 }, timestamp: 1000 });
    // 50 ms later, under the watch's interval of 100.
    emitMotion({ acceleration: { x: 0, y: 0, z: 2 }, timestamp: 1050 });
    await settle();
    expect(screen.getByText('Gravity 1.0')).toBeInTheDocument();
  });

  it('does nothing while nothing watches', () => {
    // No app rendered: no sensor runs.
    expect(() => {
      setHeading(10);
      shakeDevice();
      emitMotion({ acceleration: { x: 0, y: 0, z: 0 } });
    }).not.toThrow();
  });

  it('needs the environment', () => {
    const env = (globalThis as any).lynxTestingEnv;
    try {
      (globalThis as any).lynxTestingEnv = undefined;
      expect(() => shakeDevice()).toThrow(/shakeDevice\(\) needs/);
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });

  it('keeps the modules the thread already has', () => {
    const other = {};
    const globals: { NativeModules?: Record<string, unknown> } = {
      NativeModules: { Other: other },
    };
    installMotionModule(globals);
    expect(globals.NativeModules?.['Other']).toBe(other);
    const empty: { NativeModules?: Record<string, unknown> } = {};
    installMotionModule(empty);
    expect(Object.keys(empty.NativeModules ?? {})).toEqual([
      'AngularLynxMotion',
    ]);
  });
});
