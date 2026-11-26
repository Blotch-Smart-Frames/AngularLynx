import { describe, expect, it } from 'vitest';
import { PATH_OP } from './canvas-2d-ops';
import {
  IDENTITY,
  invert,
  isIdentity,
  LynxPath2D,
  matrixFrom,
  multiply,
  PathBuilder,
  transformSegments,
} from './path';

const { moveTo: M, lineTo: L, quadTo: Q, cubicTo: C, close: Z } = PATH_OP;

/**
 * The points a path passes through: each segment's end, rounded.
 */
const ends = (segments: number[]): number[][] => {
  const points: number[][] = [];
  for (let i = 0; i < segments.length;) {
    const op = segments[i++];
    const count = op === Z ? 0 : op === Q ? 4 : op === C ? 6 : 2;
    if (count) {
      const x = segments[i + count - 2];
      const y = segments[i + count - 1];
      points.push([
        op,
        Math.round(x * 1000) / 1000 || 0,
        Math.round(y * 1000) / 1000 || 0,
      ]);
    } else {
      points.push([op]);
    }
    i += count;
  }
  return points;
};

describe('matrices', () => {
  it('multiplies, inverts and reads DOMMatrix2DInit', () => {
    const translate = [1, 0, 0, 1, 10, 20] as const;
    const scale = [2, 0, 0, 3, 0, 0] as const;
    expect(multiply(translate, scale)).toEqual([2, 0, 0, 3, 10, 20]);
    expect(multiply(invert(translate)!, translate)).toEqual([...IDENTITY]);
    expect(invert([0, 0, 0, 0, 1, 1])).toBeNull();
    expect(invert([Infinity, 0, 0, 1, 0, 0])).toBeNull();
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(isIdentity(translate)).toBe(false);
    expect(matrixFrom(undefined)).toBe(IDENTITY);
    expect(matrixFrom({ a: 2, m22: 3, e: 4, m42: 5 })).toEqual([
      2, 0, 0, 3, 4, 5,
    ]);
    expect(matrixFrom({ a: 2, m11: 2, b: NaN, m12: NaN })).toEqual([
      2,
      NaN,
      0,
      1,
      0,
      0,
    ]);
    expect(() => matrixFrom({ a: 1, m11: 2 })).toThrow(TypeError);
    expect(() => matrixFrom(3 as never)).toThrow(TypeError);
  });
});

describe('PathBuilder', () => {
  it('moves, draws lines and curves, and closes, through its matrix', () => {
    const path = new PathBuilder();
    expect(path.isEmpty).toBe(true);
    path.matrix = [2, 0, 0, 2, 1, 1];
    path.lineTo(1, 1);
    path.lineTo(2, 1);
    path.quadraticCurveTo(3, 1, 3, 2);
    path.bezierCurveTo(3, 3, 2, 3, 1, 3);
    path.closePath();
    path.lineTo(NaN, 0);
    path.moveTo(Infinity, 0);
    path.quadraticCurveTo(NaN, 0, 0, 0);
    path.bezierCurveTo(0, 0, 0, 0, 0, NaN);
    expect(path.segments).toEqual([
      M,
      3,
      3,
      L,
      5,
      3,
      Q,
      7,
      3,
      7,
      5,
      C,
      7,
      7,
      5,
      7,
      3,
      7,
      Z,
    ]);
    path.clear();
    expect(path.isEmpty).toBe(true);
    // Nothing to close.
    path.closePath();
    expect(path.segments).toEqual([]);
  });

  it('starts a curve without a subpath at its first point', () => {
    const quad = new PathBuilder();
    quad.quadraticCurveTo(1, 2, 3, 4);
    expect(quad.segments).toEqual([M, 1, 2, Q, 1, 2, 3, 4]);
    const cubic = new PathBuilder();
    cubic.bezierCurveTo(1, 2, 3, 4, 5, 6);
    expect(cubic.segments.slice(0, 3)).toEqual([M, 1, 2]);
  });

  it('adds a rectangle, then moves to its corner', () => {
    const path = new PathBuilder();
    path.rect(1, 2, 3, 4);
    path.rect(NaN, 0, 1, 1);
    expect(ends(path.segments)).toEqual([
      [M, 1, 2],
      [L, 4, 2],
      [L, 4, 6],
      [L, 1, 6],
      [Z],
      [M, 1, 2],
    ]);
  });

  it('draws arcs as quarter turns at most, joined to the last point', () => {
    const path = new PathBuilder();
    path.moveTo(0, 0);
    path.arc(10, 10, 10, 0, Math.PI);
    expect(ends(path.segments)).toEqual([
      [M, 0, 0],
      [L, 20, 10],
      [C, 10, 20],
      [C, 0, 10],
    ]);
    // A quarter circle's control point is 0.5523 of the radius along the
    // tangent.
    expect(path.segments[7]).toBeCloseTo(20);
    expect(path.segments[8]).toBeCloseTo(15.523, 3);
  });

  it('sweeps arcs as the spec has it', () => {
    const turns = (start: number, end: number, ccw: boolean) => {
      const path = new PathBuilder();
      path.arc(0, 0, 1, start, end, ccw);
      return path.segments.filter((value) => value === C).length;
    };
    // A turn or more in its direction is a whole circle.
    expect(turns(0, 7, false)).toBe(4);
    expect(turns(0, -7, true)).toBe(4);
    // Otherwise the part of a turn between the angles, either way round.
    expect(turns(0, -Math.PI / 2, false)).toBe(3);
    expect(turns(0, Math.PI / 2, true)).toBe(3);
    expect(turns(1, 1, false)).toBe(0);
  });

  it('draws rotated ellipses, and refuses negative radii', () => {
    const path = new PathBuilder();
    path.ellipse(0, 0, 10, 5, Math.PI / 2, 0, Math.PI / 2);
    expect(ends(path.segments)).toEqual([
      [M, 0, 10],
      [C, -5, 0],
    ]);
    path.ellipse(NaN, 0, 1, 1, 0, 0, 1);
    expect(() => path.arc(0, 0, -1, 0, 1)).toThrow(
      expect.objectContaining({
        name: 'IndexSizeError',
        message: expect.stringMatching(/radius provided \(-1\)/),
      }),
    );
    expect(() => path.ellipse(0, 0, -1, 1, 0, 0, 1)).toThrow(
      /major-axis radius provided \(-1\)/,
    );
    expect(() => path.ellipse(0, 0, 1, -2, 0, 0, 1)).toThrow(
      /minor-axis radius provided \(-2\)/,
    );
  });

  it('rounds a corner with arcTo', () => {
    const path = new PathBuilder();
    path.moveTo(0, 0);
    path.arcTo(10, 0, 10, 10, 5);
    expect(ends(path.segments)).toEqual([
      [M, 0, 0],
      [L, 5, 0],
      [L, 5, 0],
      [C, 10, 5],
    ]);
    // Turning the other way.
    const other = new PathBuilder();
    other.moveTo(0, 0);
    other.arcTo(10, 0, 10, -10, 5);
    expect(ends(other.segments).at(-1)).toEqual([C, 10, -5]);
  });

  it('draws a line for arcTo when there is no corner to round', () => {
    const straight = (build: (path: PathBuilder) => void) => {
      const path = new PathBuilder();
      build(path);
      return ends(path.segments);
    };
    // No subpath: its first point.
    expect(straight((p) => p.arcTo(1, 2, 3, 4, 5))).toEqual([
      [M, 1, 2],
      [L, 1, 2],
    ]);
    // In line, or no radius.
    expect(straight((p) => (p.moveTo(0, 0), p.arcTo(1, 0, 2, 0, 5)))).toEqual([
      [M, 0, 0],
      [L, 1, 0],
    ]);
    expect(straight((p) => (p.moveTo(0, 0), p.arcTo(1, 0, 1, 1, 0)))).toEqual([
      [M, 0, 0],
      [L, 1, 0],
    ]);
    expect(straight((p) => (p.moveTo(0, 0), p.arcTo(1, 0, 1, 0, 3)))).toEqual([
      [M, 0, 0],
      [L, 1, 0],
    ]);
    expect(straight((p) => p.arcTo(NaN, 0, 0, 0, 1))).toEqual([]);
    const path = new PathBuilder();
    expect(() => path.arcTo(0, 0, 1, 1, -1)).toThrow(/radius provided \(-1\)/);
    // A matrix that can't be undone has no last point to go from.
    path.moveTo(0, 0);
    path.matrix = [0, 0, 0, 0, 0, 0];
    path.arcTo(1, 0, 1, 1, 1);
    expect(path.segments).toEqual([M, 0, 0]);
  });

  it('takes the last point back through the matrix for arcTo', () => {
    // A start point the scale moves: (2, 4) is (1, 2) in the scaled space.
    const path = new PathBuilder();
    path.moveTo(2, 4);
    path.matrix = [2, 0, 0, 2, 0, 0];
    path.arcTo(5, 2, 5, 7, 2.5);
    expect(ends(path.segments).slice(1)).toEqual([
      [L, 5, 4],
      [L, 5, 4],
      [C, 10, 9],
    ]);
  });

  it('rounds a corner at any scale, and draws at least one curve for any sweep', () => {
    const path = new PathBuilder();
    path.matrix = [1e8, 0, 0, 1e8, 0, 0];
    path.moveTo(0, 0);
    path.arcTo(1e-6, 0, 1e-6, 1e-6, 5e-7);
    expect(ends(path.segments).at(-1)).toEqual([C, 100, 50]);
    // And anywhere: a corner far from the origin, moved into view.
    const far = new PathBuilder();
    far.matrix = [2 ** 26, 0, 0, 2 ** 26, -(2 ** 46), 0];
    far.moveTo(2 ** 20 - 2 ** -21, 0);
    far.arcTo(2 ** 20, 0, 2 ** 20, 2 ** -21, 2 ** -22);
    expect(ends(far.segments).at(-1)).toEqual([C, 0, 16]);
    const tiny = new PathBuilder();
    tiny.arc(-1e9, 0, 1e9, 0, 1e-9);
    expect(tiny.segments.filter((value) => value === C).length).toBe(1);
  });

  it('draws rounded rectangles with every form of radii', () => {
    const shape = (
      radii: Parameters<PathBuilder['roundRect']>[4],
      w = 10,
      h = 10,
    ) => {
      const path = new PathBuilder();
      path.roundRect(0, 0, w, h, radii);
      // Each corner's arc starts with a line to where the last one ended.
      return ends(path.segments).filter(
        (point, index, all) =>
          index === 0 || point.join() !== all[index - 1].join(),
      );
    };
    expect(shape(2)).toEqual([
      [M, 2, 0],
      [L, 8, 0],
      [C, 10, 2],
      [L, 10, 8],
      [C, 8, 10],
      [L, 2, 10],
      [C, 0, 8],
      [L, 0, 2],
      [C, 2, 0],
      [Z],
      [M, 0, 0],
    ]);
    expect(shape(undefined)).toEqual([
      [M, 0, 0],
      [L, 10, 0],
      [L, 10, 10],
      [L, 0, 10],
      [L, 0, 0],
      [Z],
      [M, 0, 0],
    ]);
    expect(shape([{ x: 2, y: 1 }]).slice(0, 3)).toEqual([
      [M, 2, 0],
      [L, 8, 0],
      [C, 10, 1],
    ]);
    expect(shape([{}]).slice(0, 2)).toEqual([
      [M, 0, 0],
      [L, 10, 0],
    ]);
    // Two radii: top-left and bottom-right, then the others.
    expect(shape([1, 2]).slice(0, 3)).toEqual([
      [M, 1, 0],
      [L, 8, 0],
      [C, 10, 2],
    ]);
    // Three: top-left, the top-right and bottom-left, bottom-right.
    expect(shape([1, 2, 3])[4]).toEqual([C, 7, 10]);
    expect(shape([1, 2, 3, 4])[6]).toEqual([C, 0, 6]);
    // Radii too big for the rectangle are scaled down together.
    expect(shape([10]).slice(0, 2)).toEqual([
      [M, 5, 0],
      [L, 5, 0],
    ]);
    // A negative size goes the other way from the corner, corners with it.
    expect(shape([1, 0, 0, 0], -10, 10)[0]).toEqual([M, -10, 0]);
    expect(shape([1, 0, 0, 0], 10, -10)[0]).toEqual([M, 0, -10]);
  });

  it('takes any iterable of radii', () => {
    // A point with no iterator method is one radius.
    const point = new PathBuilder();
    point.roundRect(0, 0, 10, 10, {
      x: 2,
      y: 3,
      [Symbol.iterator]: undefined,
    } as never);
    expect(ends(point.segments).slice(0, 2)).toEqual([
      [M, 2, 0],
      [L, 8, 0],
    ]);
    const path = new PathBuilder();
    path.roundRect(0, 0, 10, 10, new Set([2, 4]));
    expect(ends(path.segments).slice(0, 3)).toEqual([
      [M, 2, 0],
      [L, 6, 0],
      [L, 6, 0],
    ]);
  });

  it('draws a rectangle with one negative side the other way round, as browsers do', () => {
    /**
     * Clockwise: top-left, top-right, bottom-right, bottom-left.
     */
    const area = (segments: number[]) => {
      const points = ends(segments)
        .filter((point) => point.length === 3)
        .map(([, x, y]) => [x, y]);
      let sum = 0;
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        sum += ax * by - bx * ay;
      }
      return Math.sign(sum);
    };
    const shape = (w: number, h: number) => {
      const path = new PathBuilder();
      path.roundRect(80, 20, w, h, 8);
      // Leave out the move to the next subpath.
      return path.segments.slice(0, path.segments.lastIndexOf(Z) + 1);
    };
    expect(area(shape(60, 60))).toBe(1);
    expect(area(shape(-60, 60))).toBe(-1);
    expect(area(shape(60, -60))).toBe(-1);
    expect(area(shape(-60, -60))).toBe(1);
    // The next subpath starts at the point given.
    const path = new PathBuilder();
    path.roundRect(80, 20, -60, 60, 8);
    expect(path.segments.slice(-3)).toEqual([M, 80, 20]);
  });

  it('turns down radii roundRect can’t draw', () => {
    const path = new PathBuilder();
    expect(() => path.roundRect(0, 0, 1, 1, [])).toThrow(RangeError);
    expect(() => path.roundRect(0, 0, 1, 1, [1, 2, 3, 4, 5])).toThrow(
      /5 radii/,
    );
    expect(() => path.roundRect(0, 0, 1, 1, -1)).toThrow(/-1 is negative/);
    expect(() => path.roundRect(0, 0, 1, 1, { x: 1, y: -2 })).toThrow(
      /-2 is negative/,
    );
    path.roundRect(0, 0, 1, 1, NaN);
    path.roundRect(NaN, 0, 1, 1, 1);
    expect(path.segments).toEqual([]);
  });

  it('adds another path’s segments through a matrix', () => {
    const source = new PathBuilder();
    source.moveTo(1, 1);
    source.quadraticCurveTo(2, 2, 3, 3);
    source.closePath();
    source.bezierCurveTo(1, 1, 1, 1, 1, 1);
    source.lineTo(4, 4);
    const path = new PathBuilder();
    path.addSegments(source.segments, [2, 0, 0, 2, 0, 0]);
    expect(path.segments).toEqual([
      M,
      2,
      2,
      Q,
      4,
      4,
      6,
      6,
      Z,
      C,
      2,
      2,
      2,
      2,
      2,
      2,
      L,
      8,
      8,
    ]);
    // After a close, the last point is the subpath's first.
    path.closePath();
    path.arcTo(10, 2, 10, 10, 0);
    expect(ends(path.segments).at(-1)).toEqual([L, 10, 2]);
    path.addSegments([M, 0, 0], [NaN, 0, 0, 1, 0, 0]);
    expect(path.segments.length).toBe(23);
    expect(transformSegments([M, 1, 1], [1, 0, 0, 1, 1, 0])).toEqual([M, 2, 1]);
    const same = [M, 1, 1];
    expect(transformSegments(same, IDENTITY)).toEqual(same);
    expect(transformSegments(same, IDENTITY)).not.toBe(same);
  });
});

describe('LynxPath2D', () => {
  it('builds with the context’s path methods', () => {
    const path = new LynxPath2D();
    path.moveTo(0, 0);
    path.lineTo(1, 0);
    path.quadraticCurveTo(2, 0, 2, 1);
    path.bezierCurveTo(2, 2, 1, 2, 0, 2);
    path.arcTo(0, 3, 1, 3, 1);
    path.rect(0, 0, 1, 1);
    path.roundRect(0, 0, 4, 4, 1);
    path.arc(0, 0, 1, 0, 1);
    path.ellipse(0, 0, 1, 2, 0, 0, 1, true);
    path.arc(0, 0, 1, 0, 1, true);
    path.closePath();
    expect(path.builder.segments.length).toBeGreaterThan(40);
    expect(path.builder.segments.at(-1)).toBe(Z);
  });

  it('copies a path, and adds one through a transform', () => {
    const square = new LynxPath2D();
    square.rect(0, 0, 1, 1);
    const copy = new LynxPath2D(square);
    expect(copy.builder.segments).toEqual(square.builder.segments);
    const moved = new LynxPath2D();
    moved.addPath(square, { e: 5 });
    expect(moved.builder.segments.slice(0, 3)).toEqual([M, 5, 0]);
    expect(() => moved.addPath({} as LynxPath2D)).toThrow(
      /not of type 'Path2D'/,
    );
  });

  it('reads SVG path data, absolute and relative', () => {
    const path = new LynxPath2D('M10 10 h 10 v10 H5 V5 L 0 0 l5,5 Z m 1 1 2 2');
    expect(ends(path.builder.segments)).toEqual([
      [M, 10, 10],
      [L, 20, 10],
      [L, 20, 20],
      [L, 5, 20],
      [L, 5, 5],
      [L, 0, 0],
      [L, 5, 5],
      [Z],
      [M, 11, 11],
      [L, 13, 13],
    ]);
  });

  it('repeats a command for more points, a move as lines', () => {
    expect(
      ends(new LynxPath2D('M 0 0 1 1 L 2 2 3 3').builder.segments),
    ).toEqual([
      [M, 0, 0],
      [L, 1, 1],
      [L, 2, 2],
      [L, 3, 3],
    ]);
  });

  it('reads SVG curves, smooth ones reflecting the last control point', () => {
    const path = new LynxPath2D(
      'M0 0 C 0 10 10 10 10 0 S 20 -10 20 0 s 10 10 10 0 Q 35 10 40 0 T 50 0 t 10 0 q 5 5 10 0',
    );
    const segments = path.builder.segments;
    // S reflects C's second control point (10,10) through (10,0).
    expect(segments.slice(11, 13)).toEqual([10, -10]);
    // T reflects Q's control point (35,10) through (40,0).
    expect(ends(segments)).toContainEqual([Q, 50, 0]);
    const index = segments.indexOf(Q, 20);
    expect(segments.slice(index + 6, index + 8)).toEqual([45, -10]);
    // A smooth curve after a line has no control point to reflect.
    const plain = new LynxPath2D('M0 0 L 5 5 S 10 10 10 0 T 20 0');
    expect(plain.builder.segments.slice(7, 9)).toEqual([5, 5]);
  });

  it('reads SVG arcs, with flags run together', () => {
    const arc = new LynxPath2D('M0 0 A 10 10 0 0 1 20 0');
    expect(ends(arc.builder.segments).at(-1)).toEqual([C, 20, 0]);
    // The other way round, the large arc, and flags without spaces.
    const other = new LynxPath2D('M0 0 a10 10 0 1020 0');
    expect(ends(other.builder.segments).at(-1)).toEqual([C, 20, 0]);
    // Radii too small to reach are scaled up.
    const scaled = new LynxPath2D('M0 0 A 1 1 0 0 0 20 0');
    expect(ends(scaled.builder.segments).at(-1)).toEqual([C, 20, 0]);
    // A sweep the other way than the arc's angle.
    const swept = new LynxPath2D('M0 0 A 10 10 0 1 1 20 0');
    expect(ends(swept.builder.segments).at(-1)).toEqual([C, 20, 0]);
    // No radius is a line; no distance is nothing.
    expect(
      ends(new LynxPath2D('M0 0 A 0 5 0 0 1 5 5').builder.segments),
    ).toEqual([
      [M, 0, 0],
      [L, 5, 5],
    ]);
    expect(
      ends(new LynxPath2D('M0 0 A 5 5 0 0 1 0 0').builder.segments),
    ).toEqual([[M, 0, 0]]);
  });

  it('starts path data with a move, and stops it at anything else', () => {
    expect(new LynxPath2D('L10 10 L20 20').builder.segments).toEqual([]);
    expect(
      ends(new LynxPath2D('M0 0 L10 ! 20 L30 40').builder.segments),
    ).toEqual([[M, 0, 0]]);
    // A comma goes between two numbers only.
    expect(
      ends(new LynxPath2D('M0 0 L10 10 L,20 20').builder.segments),
    ).toEqual([
      [M, 0, 0],
      [L, 10, 10],
    ]);
    expect(new LynxPath2D(',M0 0 L1 1').builder.segments).toEqual([]);
    expect(ends(new LynxPath2D('M0 0 L1 1, L2 2').builder.segments)).toEqual([
      [M, 0, 0],
      [L, 1, 1],
    ]);
    expect(ends(new LynxPath2D('m1,1 l2,2').builder.segments)).toEqual([
      [M, 1, 1],
      [L, 3, 3],
    ]);
  });

  it('keeps what came before an error in the data', () => {
    expect(ends(new LynxPath2D('M 0 0 L 1 1 L 2').builder.segments)).toEqual([
      [M, 0, 0],
      [L, 1, 1],
    ]);
    expect(new LynxPath2D('10 10').builder.segments).toEqual([]);
    expect(new LynxPath2D('').builder.segments).toEqual([]);
    expect(ends(new LynxPath2D('M0 0 Z 5 5').builder.segments)).toEqual([
      [M, 0, 0],
      [Z],
    ]);
    expect(
      ends(new LynxPath2D('M0 0 A 1 1 0 2 0 5 5').builder.segments),
    ).toEqual([[M, 0, 0]]);
    expect(ends(new LynxPath2D('M0 0 A 1 1 0 0').builder.segments)).toEqual([
      [M, 0, 0],
    ]);
    expect(ends(new LynxPath2D('M0 0 A 1 1 0 0 L').builder.segments)).toEqual([
      [M, 0, 0],
    ]);
  });
});
