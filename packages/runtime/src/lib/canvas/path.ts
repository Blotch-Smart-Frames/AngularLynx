import { PATH_OP } from './canvas-2d-ops';

/**
 * Paths for the 2D context: the context's current path and `Path2D`, built
 * here as moves, lines and Bézier curves, the segments every platform draws.
 * Arcs, ellipses and rounded rectangles become cubic curves (at most a
 * quarter turn each, within 0.03% of the circle), which an affine transform
 * maps exactly, so a path's points can be transformed as they're added, as
 * the canvas spec has it: a context's path is kept in the canvas's pixels,
 * transformed by the matrix of the moment each point was added.
 */

/** A 2D affine matrix, as `[a, b, c, d, e, f]` (DOMMatrix's names). */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `left` then `right`: what `context.transform(right)` makes of `left`. */
export const multiply = (left: Matrix, right: Matrix): Matrix => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
];

export const invert = (m: Matrix): Matrix | null => {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
};

export const isIdentity = (m: Matrix): boolean =>
  m[0] === 1 &&
  m[1] === 0 &&
  m[2] === 0 &&
  m[3] === 1 &&
  m[4] === 0 &&
  m[5] === 0;

/** DOMMatrix2DInit: `{ a … f }` or `{ m11, m12, m21, m22, m41, m42 }`. */
export type MatrixInit = {
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  e?: number;
  f?: number;
  m11?: number;
  m12?: number;
  m21?: number;
  m22?: number;
  m41?: number;
  m42?: number;
};

/** A DOMMatrix2DInit as a matrix; identity for undefined, as browsers. */
export const matrixFrom = (init: MatrixInit | null | undefined): Matrix => {
  if (init === null || init === undefined) return IDENTITY;
  if (typeof init !== 'object') {
    throw new TypeError("Failed to convert value to 'DOMMatrix2DInit'.");
  }
  const pick = (
    short: number | undefined,
    long: number | undefined,
    fallback: number,
  ) => {
    if (
      short !== undefined &&
      long !== undefined &&
      short !== long &&
      !(Number.isNaN(short) && Number.isNaN(long))
    ) {
      throw new TypeError(
        'The DOMMatrix2DInit has two different values for the same member.',
      );
    }
    return Number(short ?? long ?? fallback);
  };
  return [
    pick(init.a, init.m11, 1),
    pick(init.b, init.m12, 0),
    pick(init.c, init.m21, 0),
    pick(init.d, init.m22, 1),
    pick(init.e, init.m41, 0),
    pick(init.f, init.m42, 0),
  ];
};

const finite = (...values: number[]): boolean =>
  values.every((value) => Number.isFinite(value));

const TAU = Math.PI * 2;

/**
 * `value` mod `TAU`, in [0, TAU).
 */
const positiveAngle = (value: number): number => ((value % TAU) + TAU) % TAU;

const indexSizeError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'IndexSizeError';
  return error;
};

/**
 * The sweep of an arc from `start` to `end`, as the canvas spec has it: a
 * whole turn when the angles are a turn or more apart in the arc's
 * direction, and otherwise the part of a turn between them.
 */
const sweepOf = (
  start: number,
  end: number,
  counterclockwise: boolean,
): number => {
  if (!counterclockwise) {
    if (end - start >= TAU) return TAU;
    return positiveAngle(end - start);
  }
  if (start - end >= TAU) return -TAU;
  return -positiveAngle(start - end);
};

/**
 * A path: segments in one number array (see PATH_OP), in the space `#matrix`
 * maps the given points to. The context's path takes the context's current
 * transform; a Path2D takes none, and is transformed when it's drawn.
 */
export class PathBuilder {
  /** The segments, transformed. */
  segments: number[] = [];
  /** Whether there's a subpath, so a point to draw from. */
  #hasPoint = false;
  // The last point and the subpath's first, transformed.
  #lastX = 0;
  #lastY = 0;
  #startX = 0;
  #startY = 0;

  /** The matrix points are transformed by as they're added. */
  matrix: Matrix = IDENTITY;

  clear(): void {
    this.segments = [];
    this.#hasPoint = false;
  }

  get isEmpty(): boolean {
    return this.segments.length === 0;
  }

  #map(x: number, y: number): [number, number] {
    const m = this.matrix;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  #moveToMapped(x: number, y: number): void {
    this.segments.push(PATH_OP.moveTo, x, y);
    this.#hasPoint = true;
    this.#lastX = this.#startX = x;
    this.#lastY = this.#startY = y;
  }

  #lineToMapped(x: number, y: number): void {
    if (!this.#hasPoint) {
      this.#moveToMapped(x, y);
      return;
    }
    this.segments.push(PATH_OP.lineTo, x, y);
    this.#lastX = x;
    this.#lastY = y;
  }

  /**
   * Makes sure there's a subpath, as the spec's curves do.
   */
  #ensure(x: number, y: number): void {
    if (!this.#hasPoint) this.#moveToMapped(...this.#map(x, y));
  }

  moveTo(x: number, y: number): void {
    if (!finite(x, y)) return;
    this.#moveToMapped(...this.#map(x, y));
  }

  lineTo(x: number, y: number): void {
    if (!finite(x, y)) return;
    this.#lineToMapped(...this.#map(x, y));
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!finite(cpx, cpy, x, y)) return;
    this.#ensure(cpx, cpy);
    const [px, py] = this.#map(cpx, cpy);
    const [ex, ey] = this.#map(x, y);
    this.segments.push(PATH_OP.quadTo, px, py, ex, ey);
    this.#lastX = ex;
    this.#lastY = ey;
  }

  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    if (!finite(cp1x, cp1y, cp2x, cp2y, x, y)) return;
    this.#ensure(cp1x, cp1y);
    const [ax, ay] = this.#map(cp1x, cp1y);
    const [bx, by] = this.#map(cp2x, cp2y);
    const [ex, ey] = this.#map(x, y);
    this.segments.push(PATH_OP.cubicTo, ax, ay, bx, by, ex, ey);
    this.#lastX = ex;
    this.#lastY = ey;
  }

  closePath(): void {
    if (!this.#hasPoint) return;
    this.segments.push(PATH_OP.close);
    this.#lastX = this.#startX;
    this.#lastY = this.#startY;
  }

  rect(x: number, y: number, w: number, h: number): void {
    if (!finite(x, y, w, h)) return;
    this.#moveToMapped(...this.#map(x, y));
    this.#lineToMapped(...this.#map(x + w, y));
    this.#lineToMapped(...this.#map(x + w, y + h));
    this.#lineToMapped(...this.#map(x, y + h));
    this.closePath();
    this.#moveToMapped(...this.#map(x, y));
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.ellipse(
      x,
      y,
      radius,
      radius,
      0,
      startAngle,
      endAngle,
      counterclockwise,
      'arc',
    );
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
    method = 'ellipse',
  ): void {
    if (!finite(x, y, radiusX, radiusY, rotation, startAngle, endAngle)) return;
    if (radiusX < 0 || radiusY < 0) {
      throw indexSizeError(
        `Failed to execute '${method}' on 'CanvasRenderingContext2D': The ${method === 'arc' ? 'radius' : `${radiusX < 0 ? 'major' : 'minor'}-axis radius`} provided (${radiusX < 0 ? radiusX : radiusY}) is negative.`,
      );
    }
    const sweep = sweepOf(startAngle, endAngle, !!counterclockwise);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    /**
     * A point of the ellipse at parameter t, before the context's matrix.
     */
    const point = (t: number): [number, number] => {
      const px = radiusX * Math.cos(t);
      const py = radiusY * Math.sin(t);
      return [x + px * cos - py * sin, y + px * sin + py * cos];
    };
    const [sx, sy] = point(startAngle);
    this.#lineToMapped(...this.#map(sx, sy));
    if (sweep === 0) return;
    // At least one curve for any sweep, however small.
    const count = Math.max(
      1,
      Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9),
    );
    const step = sweep / count;
    // The control points' distance along the tangent, as a fraction of the
    // radius, for a curve spanning `step`.
    const k = (4 / 3) * Math.tan(step / 4);
    let t = startAngle;
    for (let i = 0; i < count; i++) {
      const t2 = t + step;
      const derivative = (angle: number): [number, number] => {
        const dx = -radiusX * Math.sin(angle);
        const dy = radiusY * Math.cos(angle);
        return [dx * cos - dy * sin, dx * sin + dy * cos];
      };
      const [x1, y1] = point(t);
      const [x2, y2] = point(t2);
      const [d1x, d1y] = derivative(t);
      const [d2x, d2y] = derivative(t2);
      const [ax, ay] = this.#map(x1 + k * d1x, y1 + k * d1y);
      const [bx, by] = this.#map(x2 - k * d2x, y2 - k * d2y);
      const [ex, ey] = this.#map(x2, y2);
      this.segments.push(PATH_OP.cubicTo, ax, ay, bx, by, ex, ey);
      this.#lastX = ex;
      this.#lastY = ey;
      t = t2;
    }
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    if (!finite(x1, y1, x2, y2, radius)) return;
    if (radius < 0) {
      throw indexSizeError(
        `Failed to execute 'arcTo' on 'CanvasRenderingContext2D': The radius provided (${radius}) is negative.`,
      );
    }
    this.#ensure(x1, y1);
    // The last point, in the space the arguments are in.
    const inverse = invert(this.matrix);
    if (!inverse) return;
    const x0 = inverse[0] * this.#lastX + inverse[2] * this.#lastY + inverse[4];
    const y0 = inverse[1] * this.#lastX + inverse[3] * this.#lastY + inverse[5];
    // The tests are relative to the lines' lengths, so they hold at any
    // scale: a corner a millionth of a pixel across, scaled up by 1e8, is a
    // corner.
    const l1 = Math.hypot(x1 - x0, y1 - y0);
    const l2 = Math.hypot(x2 - x1, y2 - y1);
    const cross = (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1);
    const tiny = 1e-12 * Math.max(1, Math.abs(x1), Math.abs(y1));
    if (
      l1 <= tiny ||
      l2 <= tiny ||
      radius === 0 ||
      Math.abs(cross) <= 1e-12 * l1 * l2
    ) {
      this.lineTo(x1, y1);
      return;
    }
    // The tangent points on the two lines, a distance from the corner that
    // fits a circle of the radius in the angle between them.
    const v1x = x0 - x1;
    const v1y = y0 - y1;
    const v2x = x2 - x1;
    const v2y = y2 - y1;
    const angle = Math.acos(
      Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2))),
    );
    const distance = radius / Math.tan(angle / 2);
    const t1x = x1 + (v1x / l1) * distance;
    const t1y = y1 + (v1y / l1) * distance;
    const t2x = x1 + (v2x / l2) * distance;
    const t2y = y1 + (v2y / l2) * distance;
    // The circle's center is along the normal to the first line, on the
    // side the path turns to.
    const sign = cross > 0 ? 1 : -1;
    const cx = t1x + (sign * v1y * radius) / l1;
    const cy = t1y - (sign * v1x * radius) / l1;
    const start = Math.atan2(t1y - cy, t1x - cx);
    const end = Math.atan2(t2y - cy, t2x - cx);
    this.lineTo(t1x, t1y);
    this.arc(cx, cy, radius, start, end, cross < 0);
  }

  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: number | RadiusInit | Iterable<number | RadiusInit> = 0,
  ): void {
    if (!finite(x, y, w, h)) return;
    // A sequence of radii is any iterable; a DOMPointInit is one radius.
    const list =
      typeof radii === 'object' && radii !== null && Symbol.iterator in radii
        ? Array.from(radii as Iterable<number | RadiusInit>)
        : [radii as number | RadiusInit];
    if (list.length < 1 || list.length > 4) {
      throw new RangeError(
        `Failed to execute 'roundRect' on 'CanvasRenderingContext2D': ${list.length} radii provided. Between one and four radii are necessary.`,
      );
    }
    const corners: [number, number][] = [];
    for (const radius of list) {
      let rx: number;
      let ry: number;
      if (typeof radius === 'object' && radius !== null) {
        rx = Number(radius.x ?? 0);
        ry = Number(radius.y ?? 0);
      } else {
        rx = ry = Number(radius);
      }
      if (!finite(rx, ry)) return;
      if (rx < 0 || ry < 0) {
        throw new RangeError(
          `Failed to execute 'roundRect' on 'CanvasRenderingContext2D': Radius value ${rx < 0 ? rx : ry} is negative.`,
        );
      }
      corners.push([rx, ry]);
    }
    // Top-left, top-right, bottom-right, bottom-left, as CSS's border-radius.
    let [tl, tr, br, bl] = (() => {
      switch (corners.length) {
        case 1:
          return [corners[0], corners[0], corners[0], corners[0]];
        case 2:
          return [corners[0], corners[1], corners[0], corners[1]];
        case 3:
          return [corners[0], corners[1], corners[2], corners[1]];
        default:
          return corners;
      }
    })();
    // A rectangle drawn with a negative size is flipped, corners with it,
    // and when only one side is negative, it's drawn the other way round, as
    // browsers do, so its winding tells nonzero filling it's mirrored.
    const startX = x;
    const startY = y;
    const reversed = w < 0 !== h < 0;
    if (w < 0) {
      x += w;
      w = -w;
      [tl, tr, br, bl] = [tr, tl, bl, br];
    }
    if (h < 0) {
      y += h;
      h = -h;
      [tl, tr, br, bl] = [bl, br, tr, tl];
    }
    /**
     * Radii that don't fit are scaled down together.
     */
    const fit = (length: number, sum: number) =>
      sum > 0 ? length / sum : Infinity;
    const scale = Math.min(
      1,
      fit(w, tl[0] + tr[0]),
      fit(w, bl[0] + br[0]),
      fit(h, tl[1] + bl[1]),
      fit(h, tr[1] + br[1]),
    );
    const r = (corner: [number, number]): [number, number] => [
      corner[0] * scale,
      corner[1] * scale,
    ];
    const [tlx, tly] = r(tl);
    const [trx, try_] = r(tr);
    const [brx, bry] = r(br);
    const [blx, bly] = r(bl);
    this.moveTo(x + tlx, y);
    if (reversed) {
      if (tlx || tly) {
        this.ellipse(
          x + tlx,
          y + tly,
          tlx,
          tly,
          0,
          Math.PI * 1.5,
          Math.PI,
          true,
        );
      }
      this.lineTo(x, y + h - bly);
      if (blx || bly) {
        this.ellipse(
          x + blx,
          y + h - bly,
          blx,
          bly,
          0,
          Math.PI,
          Math.PI / 2,
          true,
        );
      }
      this.lineTo(x + w - brx, y + h);
      if (brx || bry) {
        this.ellipse(
          x + w - brx,
          y + h - bry,
          brx,
          bry,
          0,
          Math.PI / 2,
          0,
          true,
        );
      }
      this.lineTo(x + w, y + try_);
      if (trx || try_) {
        this.ellipse(
          x + w - trx,
          y + try_,
          trx,
          try_,
          0,
          0,
          -Math.PI / 2,
          true,
        );
      }
    } else {
      this.lineTo(x + w - trx, y);
      if (trx || try_) {
        this.ellipse(x + w - trx, y + try_, trx, try_, 0, -Math.PI / 2, 0);
      }
      this.lineTo(x + w, y + h - bry);
      if (brx || bry) {
        this.ellipse(x + w - brx, y + h - bry, brx, bry, 0, 0, Math.PI / 2);
      }
      this.lineTo(x + blx, y + h);
      if (blx || bly) {
        this.ellipse(x + blx, y + h - bly, blx, bly, 0, Math.PI / 2, Math.PI);
      }
      this.lineTo(x, y + tly);
      if (tlx || tly) {
        this.ellipse(x + tlx, y + tly, tlx, tly, 0, Math.PI, Math.PI * 1.5);
      }
    }
    this.closePath();
    // The next subpath starts at the point given, as the spec has it.
    this.moveTo(startX, startY);
  }

  /**
   * Adds another path's segments, transformed by `matrix` then this one's.
   */
  addSegments(segments: readonly number[], matrix: Matrix): void {
    const m = multiply(this.matrix, matrix);
    if (!finite(...m)) return;
    for (let i = 0; i < segments.length;) {
      const op = segments[i++];
      const count =
        op === PATH_OP.close
          ? 0
          : op === PATH_OP.quadTo
            ? 4
            : op === PATH_OP.cubicTo
              ? 6
              : 2;
      if (op === PATH_OP.close) {
        this.segments.push(op);
        this.#lastX = this.#startX;
        this.#lastY = this.#startY;
        continue;
      }
      this.segments.push(op);
      let x = 0;
      let y = 0;
      for (let p = 0; p < count; p += 2) {
        const sx = segments[i++];
        const sy = segments[i++];
        x = m[0] * sx + m[2] * sy + m[4];
        y = m[1] * sx + m[3] * sy + m[5];
        this.segments.push(x, y);
      }
      if (op === PATH_OP.moveTo) {
        this.#startX = x;
        this.#startY = y;
      }
      this.#hasPoint = true;
      this.#lastX = x;
      this.#lastY = y;
    }
  }
}

/** DOMPointInit, as roundRect takes for an elliptical corner. */
export type RadiusInit = { x?: number; y?: number };

/** The segments of `segments` transformed by `matrix`. */
export const transformSegments = (
  segments: readonly number[],
  matrix: Matrix,
): number[] => {
  if (isIdentity(matrix)) return segments.slice();
  const builder = new PathBuilder();
  builder.addSegments(segments, matrix);
  return builder.segments;
};

/**
 * `Path2D`: a path to fill, stroke or clip with later, built with the same
 * methods as the context's path, or from SVG path data.
 */
export class LynxPath2D {
  /** @internal */
  readonly builder = new PathBuilder();

  constructor(path?: LynxPath2D | string) {
    if (path instanceof LynxPath2D) {
      this.builder.addSegments(path.builder.segments, IDENTITY);
    } else if (path !== undefined) {
      parseSvgPath(String(path), this.builder);
    }
  }

  addPath(path: LynxPath2D, transform?: MatrixInit): void {
    if (!(path instanceof LynxPath2D)) {
      throw new TypeError(
        "Failed to execute 'addPath' on 'Path2D': parameter 1 is not of type 'Path2D'.",
      );
    }
    this.builder.addSegments(
      path.builder.segments.slice(),
      matrixFrom(transform),
    );
  }

  closePath(): void {
    this.builder.closePath();
  }
  moveTo(x: number, y: number): void {
    this.builder.moveTo(Number(x), Number(y));
  }
  lineTo(x: number, y: number): void {
    this.builder.lineTo(Number(x), Number(y));
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.builder.quadraticCurveTo(
      Number(cpx),
      Number(cpy),
      Number(x),
      Number(y),
    );
  }
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.builder.bezierCurveTo(
      Number(cp1x),
      Number(cp1y),
      Number(cp2x),
      Number(cp2y),
      Number(x),
      Number(y),
    );
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.builder.arcTo(
      Number(x1),
      Number(y1),
      Number(x2),
      Number(y2),
      Number(radius),
    );
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.builder.rect(Number(x), Number(y), Number(w), Number(h));
  }
  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii?: number | RadiusInit | Iterable<number | RadiusInit>,
  ): void {
    this.builder.roundRect(Number(x), Number(y), Number(w), Number(h), radii);
  }
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.builder.arc(
      Number(x),
      Number(y),
      Number(radius),
      Number(startAngle),
      Number(endAngle),
      !!counterclockwise,
    );
  }
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.builder.ellipse(
      Number(x),
      Number(y),
      Number(radiusX),
      Number(radiusY),
      Number(rotation),
      Number(startAngle),
      Number(endAngle),
      !!counterclockwise,
    );
  }
}

/**
 * SVG path data (`M 10 10 h 20 a 5 5 0 0 1 5 5 z`), as `new Path2D(d)`
 * takes it. As in SVG, the path ends at the first error and keeps what came
 * before it.
 */
export const parseSvgPath = (data: string, builder: PathBuilder): void => {
  // Commands and numbers, between separators: the data ends at the first
  // thing that's neither, as SVG's does.
  const tokens: string[] = [];
  const tokenPattern =
    /[\s,]*([MmZzLlHhVvCcSsQqTtAa]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y;
  for (
    let match = tokenPattern.exec(data);
    match;
    match = tokenPattern.exec(data)
  ) {
    tokens.push(match[1]);
  }
  // Path data starts with a move.
  if (tokens[0] !== 'M' && tokens[0] !== 'm') return;
  let index = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point, for S and T's reflection.
  let controlX = 0;
  let controlY = 0;
  let previous = '';
  let command = '';
  const isCommand = (token: string | undefined) =>
    token !== undefined && /^[a-z]$/i.test(token);
  const number = (): number => {
    const token = tokens[index];
    if (token === undefined || isCommand(token)) throw new Error('number');
    index++;
    return Number(token);
  };
  const flag = (): boolean => {
    // An arc's flags may run together with what follows (`a1 1 0 01 5 5`).
    const token = tokens[index];
    if (token === undefined || isCommand(token)) throw new Error('flag');
    if (token[0] !== '0' && token[0] !== '1') throw new Error('flag');
    if (token.length > 1) {
      tokens[index] = token.slice(1);
    } else {
      index++;
    }
    return token[0] === '1';
  };
  try {
    while (index < tokens.length) {
      if (isCommand(tokens[index])) {
        command = tokens[index++];
      } else if (command === '' || command === 'z' || command === 'Z') {
        return;
      } else if (command === 'M') {
        command = 'L';
      } else if (command === 'm') {
        command = 'l';
      }
      const relative = command === command.toLowerCase();
      const ox = relative ? x : 0;
      const oy = relative ? y : 0;
      switch (command.toUpperCase()) {
        case 'M':
          x = ox + number();
          y = oy + number();
          builder.moveTo(x, y);
          startX = x;
          startY = y;
          break;
        case 'L':
          x = ox + number();
          y = oy + number();
          builder.lineTo(x, y);
          break;
        case 'H':
          x = ox + number();
          builder.lineTo(x, y);
          break;
        case 'V':
          y = oy + number();
          builder.lineTo(x, y);
          break;
        case 'Z':
          builder.closePath();
          x = startX;
          y = startY;
          break;
        case 'C': {
          const x1 = ox + number();
          const y1 = oy + number();
          controlX = ox + number();
          controlY = oy + number();
          x = ox + number();
          y = oy + number();
          builder.bezierCurveTo(x1, y1, controlX, controlY, x, y);
          break;
        }
        case 'S': {
          const smooth = /[CcSs]/.test(previous);
          const x1 = smooth ? 2 * x - controlX : x;
          const y1 = smooth ? 2 * y - controlY : y;
          controlX = ox + number();
          controlY = oy + number();
          x = ox + number();
          y = oy + number();
          builder.bezierCurveTo(x1, y1, controlX, controlY, x, y);
          break;
        }
        case 'Q':
          controlX = ox + number();
          controlY = oy + number();
          x = ox + number();
          y = oy + number();
          builder.quadraticCurveTo(controlX, controlY, x, y);
          break;
        case 'T': {
          const smooth = /[QqTt]/.test(previous);
          controlX = smooth ? 2 * x - controlX : x;
          controlY = smooth ? 2 * y - controlY : y;
          x = ox + number();
          y = oy + number();
          builder.quadraticCurveTo(controlX, controlY, x, y);
          break;
        }
        default: {
          // A: the only command left.
          const rx = Math.abs(number());
          const ry = Math.abs(number());
          const rotation = (number() * Math.PI) / 180;
          const large = flag();
          const sweep = flag();
          const ex = ox + number();
          const ey = oy + number();
          svgArc(builder, x, y, rx, ry, rotation, large, sweep, ex, ey);
          x = ex;
          y = ey;
          break;
        }
      }
      previous = command;
    }
  } catch {
    // The path ends at the error.
  }
};

/**
 * SVG's arc, from its endpoints to its center, as SVG's implementation notes
 * (B.2.4) have it, then drawn as an ellipse.
 */
const svgArc = (
  builder: PathBuilder,
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  rotation: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): void => {
  if (x1 === x2 && y1 === y2) return;
  if (rx === 0 || ry === 0) {
    builder.lineTo(x2, y2);
    return;
  }
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  // Radii too small to reach are scaled up until they do.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator =
    rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let factor = Math.sqrt(Math.max(0, numerator / denominator));
  if (large === sweep) factor = -factor;
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && delta > 0) delta -= TAU;
  if (sweep && delta < 0) delta += TAU;
  builder.ellipse(cx, cy, rx, ry, rotation, start, start + delta, !sweep);
};
