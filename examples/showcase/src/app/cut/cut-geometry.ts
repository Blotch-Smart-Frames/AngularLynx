import type { Cut } from '../data/gems';

// cspell:words superellipse

/**
 * A gem's geometry, built the way a lapidary describes a cut: as rings of
 * facet corners at a radius and a height, from the table down to the culet.
 * The same build gives the 3D stone its triangles and the plate its plan
 * view, so the diagram behind the stone is the stone's own.
 */
export type CutMesh = {
  /** Triangles, three vertices each, as three.js reads them. */
  readonly positions: Float32Array;
  /** The crown's edges seen from above, as x/z pairs in girdle units. */
  readonly planEdges: readonly PlanEdge[];
};

export type PlanEdge = readonly [
  x1: number,
  z1: number,
  x2: number,
  z2: number,
];

type Vec3 = readonly [x: number, y: number, z: number];

/**
 * A ring of facet corners. `r` is its radius as a fraction of the girdle's,
 * `y` its height (the girdle sits at 0, the table above, the culet below),
 * and `twist` turns it by a fraction of a step, which is what makes the
 * triangular star and break facets between two rings.
 */
type Ring = { readonly r: number; readonly y: number; readonly twist: number };

type Profile = {
  /** The girdle's outline at a fractional corner index, in girdle units. */
  readonly outline: (index: number) => readonly [x: number, z: number];
  readonly rings: readonly Ring[];
  readonly culetY: number;
};

/** Corners per ring. Sixteen draws a believable brilliant at phone size. */
const CORNERS = 16;

/**
 * A round outline, or an oval when stretched sideways.
 */
const circle =
  (scaleX: number) =>
  (index: number): readonly [number, number] => {
    const angle = (index / CORNERS) * Math.PI * 2;
    return [Math.cos(angle) * scaleX, Math.sin(angle)];
  };

/**
 * A superellipse: a square with corners rounded by the exponent.
 */
const cushion = (index: number): readonly [number, number] => {
  const angle = (index / CORNERS) * Math.PI * 2 + Math.PI / CORNERS;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const n = 2 / 2.7;
  return [
    Math.sign(c) * Math.abs(c) ** n * 0.92,
    Math.sign(s) * Math.abs(s) ** n * 0.92,
  ];
};

/**
 * An emerald cut's outline: a rectangle with its corners cut off, eight
 * corners, and a corner halfway along each edge so every ring has sixteen.
 */
const STEP_CORNERS: readonly (readonly [number, number])[] = (() => {
  const w = 1;
  const h = 0.78;
  const c = 0.26;
  const corners: (readonly [number, number])[] = [
    [w - c, h],
    [w, h - c],
    [w, -(h - c)],
    [w - c, -h],
    [-(w - c), -h],
    [-w, -(h - c)],
    [-w, h - c],
    [-(w - c), h],
  ];
  const points: (readonly [number, number])[] = [];
  corners.forEach((corner, i) => {
    const next = corners[(i + 1) % corners.length]!;
    points.push(corner, [(corner[0] + next[0]) / 2, (corner[1] + next[1]) / 2]);
  });
  return points;
})();

const step = (index: number): readonly [number, number] =>
  STEP_CORNERS[((Math.round(index) % CORNERS) + CORNERS) % CORNERS]!;

/** Brilliant-style rings: star facets above the girdle, a culet point below. */
const BRILLIANT_RINGS: readonly Ring[] = [
  { r: 0.56, y: 0.34, twist: 0 },
  { r: 0.8, y: 0.19, twist: 0.5 },
  { r: 1, y: 0.05, twist: 0 },
  { r: 1, y: -0.05, twist: 0 },
  { r: 0.56, y: -0.52, twist: 0.5 },
];

/** Step-cut rings: concentric, untwisted, so every facet is a long quad. */
const STEP_RINGS: readonly Ring[] = [
  { r: 0.6, y: 0.3, twist: 0 },
  { r: 0.8, y: 0.21, twist: 0 },
  { r: 0.93, y: 0.1, twist: 0 },
  { r: 1, y: 0.04, twist: 0 },
  { r: 1, y: -0.04, twist: 0 },
  { r: 0.86, y: -0.3, twist: 0 },
  { r: 0.64, y: -0.58, twist: 0 },
  { r: 0.36, y: -0.82, twist: 0 },
  { r: 0.1, y: -0.95, twist: 0 },
];

const PROFILES: Record<Cut, Profile> = {
  brilliant: { outline: circle(1), rings: BRILLIANT_RINGS, culetY: -0.96 },
  oval: { outline: circle(1.28), rings: BRILLIANT_RINGS, culetY: -0.96 },
  cushion: { outline: cushion, rings: BRILLIANT_RINGS, culetY: -0.96 },
  step: { outline: step, rings: STEP_RINGS, culetY: -0.98 },
};

const ringPoints = (profile: Profile, ring: Ring): Vec3[] =>
  Array.from({ length: CORNERS }, (_, i) => {
    const [x, z] = profile.outline(i + ring.twist);
    return [x * ring.r, ring.y, z * ring.r];
  });

export const buildCut = (cut: Cut): CutMesh => {
  const profile = PROFILES[cut];
  const rings = profile.rings.map((ring) => ringPoints(profile, ring));
  const triangles: Vec3[][] = [];

  // The table: a fan from its center.
  const top = rings[0]!;
  const tableCenter: Vec3 = [0, profile.rings[0]!.y, 0];
  for (let i = 0; i < CORNERS; i++) {
    triangles.push([tableCenter, top[i]!, top[(i + 1) % CORNERS]!]);
  }

  // The strips between rings: quads when the rings line up, a zigzag of
  // triangles when the lower ring is twisted half a step.
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r]!;
    const b = rings[r + 1]!;
    const twisted = profile.rings[r]!.twist !== profile.rings[r + 1]!.twist;
    for (let i = 0; i < CORNERS; i++) {
      const j = (i + 1) % CORNERS;
      if (twisted) {
        triangles.push([a[i]!, b[i]!, a[j]!], [a[j]!, b[i]!, b[j]!]);
      } else {
        triangles.push([a[i]!, b[i]!, b[j]!], [a[i]!, b[j]!, a[j]!]);
      }
    }
  }

  // The culet: a fan down to a point.
  const bottom = rings[rings.length - 1]!;
  const culet: Vec3 = [0, profile.culetY, 0];
  for (let i = 0; i < CORNERS; i++) {
    triangles.push([bottom[i]!, culet, bottom[(i + 1) % CORNERS]!]);
  }

  // Wind every triangle outward, by its normal against the stone's center:
  // simpler than keeping the winding straight through the zigzags, and it
  // can't be wrong.
  const centerY = (profile.rings[0]!.y + profile.culetY) / 2;
  const positions = new Float32Array(triangles.length * 9);
  triangles.forEach((triangle, t) => {
    const [a, b, c] = triangle as [Vec3, Vec3, Vec3];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ];
    const centroid = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3 - centerY,
      (a[2] + b[2] + c[2]) / 3,
    ];
    const outward =
      normal[0]! * centroid[0]! +
      normal[1]! * centroid[1]! +
      normal[2]! * centroid[2]!;
    const ordered = outward >= 0 ? [a, b, c] : [a, c, b];
    ordered.forEach((vertex, v) => positions.set(vertex, t * 9 + v * 3));
  });

  // The plan view: every edge of a facet above the girdle, each once.
  const seen = new Set<string>();
  const planEdges: PlanEdge[] = [];
  const key = (p: Vec3, q: Vec3) =>
    [p, q]
      .map((v) => `${v[0].toFixed(3)},${v[2].toFixed(3)}`)
      .sort()
      .join('|');
  for (const triangle of triangles) {
    if (triangle.some((vertex) => vertex[1] < 0)) continue;
    for (let i = 0; i < 3; i++) {
      const p = triangle[i]!;
      const q = triangle[(i + 1) % 3]!;
      const k = key(p, q);
      if (seen.has(k)) continue;
      seen.add(k);
      planEdges.push([p[0], p[2], q[0], q[2]]);
    }
  }

  return { positions, planEdges };
};
