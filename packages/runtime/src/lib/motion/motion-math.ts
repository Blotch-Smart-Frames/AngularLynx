/**
 * The arithmetic behind `LynxMotion` that doesn't depend on a platform: the
 * W3C's angles from a rotation matrix, and the shake detector the web
 * preview runs (the shells run the same one natively, in `MotionModule.swift`
 * and `MotionModule.kt`, so a shake never needs every accelerometer sample to
 * cross to the main thread).
 */

/** Standard gravity, in m/s². */
export const STANDARD_GRAVITY = 9.80665;

const DEGREES = 180 / Math.PI;

/**
 * The device's orientation as `DeviceOrientationEvent` gives it, in degrees:
 * `alpha` around the z axis (0 to 360), `beta` around the x axis (-180 to
 * 180) and `gamma` around the y axis (-90 to 90), applied in that order
 * (intrinsic Z-X'-Y'').
 *
 * `r` holds the 3×3 matrix row by row from `offset`, the one Android's
 * `SensorManager.getRotationMatrixFromVector()` makes: it turns a vector in
 * the device's frame (x to the right of the screen, y up it, z out of it)
 * into the earth's (x east, y north, z up). The shells send that matrix, and
 * this is the W3C's own conversion of it (the DeviceOrientation Event
 * specification's "worked example"), so the angles match the web's.
 */
export const orientationFromMatrix = (
  r: ArrayLike<number>,
  offset = 0,
): { alpha: number; beta: number; gamma: number } => {
  const m = (index: number): number => r[offset + index] ?? 0;
  let alpha: number;
  let beta: number;
  let gamma: number;
  if (m(8) > 0) {
    alpha = Math.atan2(-m(1), m(4));
    beta = Math.asin(clampUnit(m(7)));
    gamma = Math.atan2(-m(6), m(8));
  } else if (m(8) < 0) {
    alpha = Math.atan2(m(1), -m(4));
    beta = -Math.asin(clampUnit(m(7)));
    beta += beta >= 0 ? -Math.PI : Math.PI;
    gamma = Math.atan2(m(6), -m(8));
  } else if (m(6) > 0) {
    alpha = Math.atan2(-m(1), m(4));
    beta = Math.asin(clampUnit(m(7)));
    gamma = -Math.PI / 2;
  } else if (m(6) < 0) {
    alpha = Math.atan2(m(1), -m(4));
    beta = -Math.asin(clampUnit(m(7)));
    beta += beta >= 0 ? -Math.PI : Math.PI;
    gamma = -Math.PI / 2;
  } else {
    alpha = Math.atan2(m(3), m(0));
    beta = m(7) > 0 ? Math.PI / 2 : -Math.PI / 2;
    gamma = 0;
  }
  if (alpha < 0) alpha += 2 * Math.PI;
  // Adding 0 turns atan2()'s -0 into 0, which a handler printing it would show.
  return {
    alpha: alpha * DEGREES + 0,
    beta: beta * DEGREES + 0,
    gamma: gamma * DEGREES + 0,
  };
};

/**
 * The rotation matrix {@link orientationFromMatrix} reads, for the given
 * angles in degrees: Rz(alpha) · Rx(beta) · Ry(gamma). The testing library
 * builds the matrix a shell would send from the angles a spec gives.
 */
export const matrixFromOrientation = (
  alpha: number,
  beta: number,
  gamma: number,
): number[] => {
  const [ca, sa] = [Math.cos(alpha / DEGREES), Math.sin(alpha / DEGREES)];
  const [cb, sb] = [Math.cos(beta / DEGREES), Math.sin(beta / DEGREES)];
  const [cg, sg] = [Math.cos(gamma / DEGREES), Math.sin(gamma / DEGREES)];
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
 * asin() of a value a float's rounding pushed just past ±1 is NaN.
 */
const clampUnit = (value: number): number => Math.min(1, Math.max(-1, value));

/**
 * How the shells and the web preview tell a shake from the phone being
 * carried, after Square's Seismic: a sample is accelerating when the
 * acceleration it measures, gravity included, passes 13 m/s² (about 1.3 g;
 * at rest it's 9.8), and the phone is shaking when at least three quarters
 * of the samples of the last half second accelerate, over at least a
 * quarter of a second. Walking, or putting the phone down, doesn't do that.
 * The shells sample at 50 Hz for it.
 */
export const SHAKE = {
  /** The acceleration, squared, past which a sample accelerates (m²/s⁴). */
  thresholdSquared: 13 * 13,
  /** The samples looked at, by age (ms). */
  windowMs: 500,
  /** The least time the samples must span (ms). */
  minSpanMs: 250,
  /** The least samples, so a couple of jolts at a low rate aren't a shake. */
  minSamples: 4,
  /** After a shake, how long before another can be heard (ms). */
  cooldownMs: 750,
  /** How often the shells sample the accelerometer for it (ms). */
  intervalMs: 20,
} as const;

/**
 * Hears shakes in accelerometer samples (see {@link SHAKE}). The web
 * preview runs it on `devicemotion`'s samples; the shells run their own copy.
 */
export class ShakeDetector {
  readonly #samples: { t: number; accelerating: boolean }[] = [];
  #accelerating = 0;
  #quietUntil = -Infinity;

  /**
   * Adds a sample of the acceleration, gravity included, in m/s², at `t`
   * milliseconds.
   *
   * @returns Whether the phone is shaking, now that it has.
   */
  add(t: number, x: number, y: number, z: number): boolean {
    const accelerating = x * x + y * y + z * z > SHAKE.thresholdSquared;
    this.#samples.push({ t, accelerating });
    if (accelerating) this.#accelerating++;
    while (
      this.#samples.length > 0 &&
      this.#samples[0]!.t < t - SHAKE.windowMs
    ) {
      if (this.#samples.shift()!.accelerating) this.#accelerating--;
    }
    if (t < this.#quietUntil) return false;
    const count = this.#samples.length;
    if (
      count >= SHAKE.minSamples &&
      t - this.#samples[0]!.t >= SHAKE.minSpanMs &&
      this.#accelerating * 4 >= count * 3
    ) {
      // One shake is heard once: the samples that made it don't make another.
      this.#samples.length = 0;
      this.#accelerating = 0;
      this.#quietUntil = t + SHAKE.cooldownMs;
      return true;
    }
    return false;
  }
}
