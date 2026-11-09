import type { Look } from './looks';

/**
 * A curve through the given points, read as a monotone cubic
 * (Fritsch–Carlson): smooth like a spline, but it never overshoots between
 * two points, so a curve that rises always rises. A film's characteristic
 * curve can't fold back, and an overshooting spline would make tones swap.
 */
export const monotoneCurve = (
  points: readonly (readonly [number, number])[],
): ((x: number) => number) => {
  const n = points.length;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    slopes.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]! || 1));
  }
  const tangents: number[] = [slopes[0]!];
  for (let i = 1; i < n - 1; i++) {
    const before = slopes[i - 1]!;
    const after = slopes[i]!;
    tangents.push(before * after <= 0 ? 0 : (before + after) / 2);
  }
  tangents.push(slopes[n - 2]!);
  // Fritsch–Carlson: shrink any tangent that would carry the curve past a
  // neighboring point.
  for (let i = 0; i < n - 1; i++) {
    const slope = slopes[i]!;
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i]! / slope;
    const b = tangents[i + 1]! / slope;
    const length = a * a + b * b;
    if (length > 9) {
      const scale = 3 / Math.sqrt(length);
      tangents[i] = scale * a * slope;
      tangents[i + 1] = scale * b * slope;
    }
  }
  return (x) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i]! +
      (t3 - 2 * t2 + t) * h * tangents[i]! +
      (-2 * t3 + 3 * t2) * ys[i + 1]! +
      (t3 - t2) * h * tangents[i + 1]!
    );
  };
};

/**
 * A look's three curves as a 256×1 RGBA table, the texture the develop
 * shader reads each channel through.
 */
export const curveTable = (look: Look): Uint8Array => {
  const r = monotoneCurve(look.curves.r);
  const g = monotoneCurve(look.curves.g);
  const b = monotoneCurve(look.curves.b);
  const table = new Uint8Array(256 * 4);
  const byte = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    table[i * 4] = byte(r(x));
    table[i * 4 + 1] = byte(g(x));
    table[i * 4 + 2] = byte(b(x));
    table[i * 4 + 3] = 255;
  }
  return table;
};
