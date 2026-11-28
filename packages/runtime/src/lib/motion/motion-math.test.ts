import { describe, expect, it } from 'vitest';
import {
  headingFromOrientation,
  matrixFromOrientation,
  orientationFromMatrix,
  SHAKE,
  ShakeDetector,
} from './motion-math';

describe('orientationFromMatrix', () => {
  it.each([
    [0, 0, 0],
    [90, 0, 0],
    [350, 10, 5],
    [30, 60, -45],
    [200, -120, 30],
    [45, 170, -80],
  ])(
    'gives back alpha %d, beta %d and gamma %d from their matrix',
    (alpha, beta, gamma) => {
      const angles = orientationFromMatrix(
        matrixFromOrientation(alpha, beta, gamma),
      );
      expect(angles.alpha).toBeCloseTo(alpha);
      expect(angles.beta).toBeCloseTo(beta);
      expect(angles.gamma).toBeCloseTo(gamma);
    },
  );

  // A face-up phone tipped past upright: cos(beta) < 0 takes the second
  // branch, which keeps gamma within ±90 by moving alpha and beta instead.
  it('keeps gamma within ±90 when the phone is upside down', () => {
    const angles = orientationFromMatrix(matrixFromOrientation(10, 20, 120));
    expect(angles.gamma).toBeGreaterThanOrEqual(-90);
    expect(angles.gamma).toBeLessThanOrEqual(90);
    // The same orientation: its matrix is the same.
    const again = matrixFromOrientation(
      angles.alpha,
      angles.beta,
      angles.gamma,
    );
    matrixFromOrientation(10, 20, 120).forEach((value, index) =>
      expect(again[index]).toBeCloseTo(value),
    );
  });

  it.each([
    ['standing on its side', [0, 0, 1, 0, 1, 0, -1, 0, 0]],
    ['standing on its other side', [0, 0, -1, 0, 1, 0, 1, 0, 0]],
    ['upright', [1, 0, 0, 0, 0, -1, 0, 1, 0]],
    ['upside down, upright', [1, 0, 0, 0, 0, 1, 0, -1, 0]],
  ])('reads a phone %s, where cos(beta)·cos(gamma) is 0', (_name, matrix) => {
    const angles = orientationFromMatrix(matrix);
    const again = matrixFromOrientation(
      angles.alpha,
      angles.beta,
      angles.gamma,
    );
    matrix.forEach((value, index) => expect(again[index]).toBeCloseTo(value));
  });

  // gamma ±90 exactly, tipped past upright: the last branch that moves beta.
  it('reads a phone on its side and tipped back without NaN', () => {
    const angles = orientationFromMatrix([0, 0, 1, 0, 1, 0, -0.5, 0.5, 0]);
    expect(angles.gamma).toBe(-90);
    expect(Number.isFinite(angles.alpha + angles.beta)).toBe(true);
  });

  it('reads the matrix at an offset, and a rounding past ±1 as ±1', () => {
    const angles = orientationFromMatrix(
      [99, 1, 0, 0, 0, 0, -1, 0, 1.0000000001, 1e-12],
      1,
    );
    expect(angles.beta).toBeCloseTo(90);
    // A matrix too short reads as zeros there, rather than NaN.
    expect(orientationFromMatrix([])).toEqual({
      alpha: 0,
      beta: -90,
      gamma: 0,
    });
  });
});

describe('headingFromOrientation', () => {
  it.each([
    // Flat: 360 - alpha, which a heading turns clockwise.
    [0, 0, 0, 0],
    [90, 0, 0, 270],
    [270, 10, 5, 90],
    // Tipped past upright, its top points south.
    [0, 120, 0, 180],
    // Tilted sideways, the top still points where alpha says.
    [30, 0, 60, 330],
  ])(
    'gives alpha %d, beta %d, gamma %d a heading of %d',
    (alpha, beta, gamma, heading) => {
      expect(headingFromOrientation(alpha, beta, gamma)).toBeCloseTo(heading);
    },
  );
});

describe('ShakeDetector', () => {
  const shake = (detector: ShakeDetector, from: number, to: number) => {
    let shakes = 0;
    for (let t = from; t <= to; t += SHAKE.intervalMs) {
      if (detector.add(t, (t / SHAKE.intervalMs) % 2 ? 20 : -20, 0, 9.8)) {
        shakes++;
      }
    }
    return shakes;
  };

  it('hears a shake once it has lasted a quarter of a second', () => {
    const detector = new ShakeDetector();
    let heardAt: number | undefined;
    for (let t = 0; t <= 400 && heardAt === undefined; t += 20) {
      if (detector.add(t, 20, 0, 9.8)) heardAt = t;
    }
    // The first sample a quarter of a second after the first.
    expect(heardAt).toBe(260);
  });

  // At 260 ms, and then each time the pause after a shake has passed.
  it('hears a long shake again only after the pause between shakes', () => {
    expect(shake(new ShakeDetector(), 0, 2000)).toBe(3);
  });

  it("doesn't hear a phone at rest, or carried", () => {
    const detector = new ShakeDetector();
    let shakes = 0;
    for (let t = 0; t < 3000; t += 20) {
      // Walking: a jolt every half second.
      const jolt = t % 500 === 0 ? 15 : 0;
      if (detector.add(t, 0, jolt, 9.8)) shakes++;
    }
    expect(shakes).toBe(0);
  });

  it('needs four samples, so two jolts at a low rate are no shake', () => {
    const detector = new ShakeDetector();
    expect(detector.add(0, 20, 0, 0)).toBe(false);
    expect(detector.add(300, 20, 0, 0)).toBe(false);
  });
});
