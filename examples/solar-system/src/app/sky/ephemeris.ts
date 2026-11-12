// cspell:words Standish perihelion

/**
 * Where the planets are, from JPL's "Approximate Positions of the Planets"
 * (Standish and Williams, Table 1): six Keplerian elements per planet at
 * J2000 and how fast each drifts per century. Good to a fraction of a
 * degree from 1800 to 2050, which is far finer than a phone screen shows;
 * outside that window the orbits still turn, just less exactly.
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html
 */

/** Elements and their rates per Julian century, in au and degrees. */
type Elements = readonly [
  a: number,
  e: number,
  inclination: number,
  meanLongitude: number,
  perihelion: number,
  node: number,
];

export type PlanetId =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune';

const TABLE: Record<PlanetId, readonly [Elements, Elements]> = {
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [
      0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689,
      -0.12534081,
    ],
  ],
  venus: [
    [
      0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718,
      76.67984255,
    ],
    [
      0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329,
      -0.27769418,
    ],
  ],
  // The Earth-Moon barycenter: the Moon is placed around it on screen.
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [
      0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088,
      -0.29257343,
    ],
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [
      -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668,
      0.20469106,
    ],
  ],
  saturn: [
    [
      9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831,
      113.66242448,
    ],
    [
      -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216,
      -0.28867794,
    ],
  ],
  uranus: [
    [
      19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763,
      74.01692503,
    ],
    [
      -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281,
      0.04240589,
    ],
  ],
  neptune: [
    [
      30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227,
      131.78422574,
    ],
    [
      0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464,
      -0.00508664,
    ],
  ],
};

const RAD = Math.PI / 180;
/** 2000-01-01 12:00 TT, as a JavaScript time (TT and UTC differ by ~1 min). */
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const DAY_MS = 86_400_000;
const CENTURY_DAYS = 36_525;

/** A position in the J2000 ecliptic frame, in au: z points to the north. */
export type Ecliptic = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/** Days since J2000 for a JavaScript time. */
export const daysSinceJ2000 = (time: number): number =>
  (time - J2000_MS) / DAY_MS;

/**
 * A planet's heliocentric position at a moment, following JPL's recipe:
 * the elements at the date, Kepler's equation for the eccentric anomaly,
 * then the orbit rotated into the ecliptic.
 */
export const heliocentric = (id: PlanetId, time: number): Ecliptic => {
  const t = daysSinceJ2000(time) / CENTURY_DAYS;
  const [base, rate] = TABLE[id];
  const [a, e, inclination, meanLongitude, perihelion, node] = base.map(
    (value, i) => value + rate[i]! * t,
  ) as unknown as Elements;

  const omega = (perihelion - node) * RAD;
  const bigOmega = node * RAD;
  const incl = inclination * RAD;
  // The mean anomaly, brought into -180..180 degrees.
  let mean = (meanLongitude - perihelion) % 360;
  if (mean > 180) mean -= 360;
  if (mean < -180) mean += 360;
  const anomaly = solveKepler(mean * RAD, e);

  const xOrbit = a * (Math.cos(anomaly) - e);
  const yOrbit = a * Math.sqrt(1 - e * e) * Math.sin(anomaly);
  const [cw, sw] = [Math.cos(omega), Math.sin(omega)];
  const [cn, sn] = [Math.cos(bigOmega), Math.sin(bigOmega)];
  const [ci, si] = [Math.cos(incl), Math.sin(incl)];
  return {
    x: (cw * cn - sw * sn * ci) * xOrbit + (-sw * cn - cw * sn * ci) * yOrbit,
    y: (cw * sn + sw * cn * ci) * xOrbit + (-sw * sn + cw * cn * ci) * yOrbit,
    z: sw * si * xOrbit + cw * si * yOrbit,
  };
};

/**
 * The eccentric anomaly E for a mean anomaly M (both radians), from
 * M = E - e sin E by Newton's method. Planets' orbits are near circles, so
 * a handful of steps settles it.
 */
const solveKepler = (mean: number, e: number): number => {
  let anomaly = mean + e * Math.sin(mean);
  for (let i = 0; i < 8; i++) {
    const step =
      (mean - (anomaly - e * Math.sin(anomaly))) / (1 - e * Math.cos(anomaly));
    anomaly += step;
    if (Math.abs(step) < 1e-9) break;
  }
  return anomaly;
};

/** A planet's heliocentric longitude at a moment, in radians. */
export const longitude = (id: PlanetId, time: number): number => {
  const { x, y } = heliocentric(id, time);
  return Math.atan2(y, x);
};

/** Its distance from the Sun at a moment, in au. */
export const distance = (id: PlanetId, time: number): number => {
  const { x, y, z } = heliocentric(id, time);
  return Math.hypot(x, y, z);
};

/** Its distance from Earth at a moment, in au. */
export const distanceFromEarth = (id: PlanetId, time: number): number => {
  if (id === 'earth') return 0;
  const p = heliocentric(id, time);
  const earth = heliocentric('earth', time);
  return Math.hypot(p.x - earth.x, p.y - earth.y, p.z - earth.z);
};

/**
 * The Moon's longitude around the Earth, in radians, from its mean motion
 * (a 27.32-day sidereal month) and its mean longitude at J2000. Close
 * enough to put it on the right side of the Earth for any night.
 */
export const moonLongitude = (time: number): number =>
  (218.316 + 13.176396 * daysSinceJ2000(time)) * RAD;

/** The Moon's phase as the fraction of its synodic month, new = 0. */
export const moonAge = (time: number): number => {
  const synodic = 29.530588;
  // The new moon of 2000-01-06 18:14 UTC.
  const days = (time - Date.UTC(2000, 0, 6, 18, 14)) / DAY_MS;
  return (((days % synodic) + synodic) % synodic) / synodic;
};

/** One astronomical unit, in kilometers. */
export const AU_KM = 149_597_870.7;
/** Light's travel time across one au, in minutes. */
export const AU_LIGHT_MINUTES = 8.3167;
