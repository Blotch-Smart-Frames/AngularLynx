import type { PlanetId } from './ephemeris';

// cspell:words obliquity factsheet gsfc nssdc

export type BodyId = 'sun' | PlanetId;

/** How a body's surface is drawn: see scene/shaders.ts. */
export type Surface =
  | 'sun'
  | 'rocky'
  | 'earth'
  | 'venus'
  | 'banded'
  | 'ice-giant';

export type Body = {
  readonly id: BodyId;
  readonly name: string;
  /** Its place from the Sun, as an orrery's arms are numbered. */
  readonly numeral: string;
  readonly kind: string;
  /** One true line about it. */
  readonly note: string;

  // The figures on its plate, from NASA's fact sheets (March 2025): the
  // planets' from nssdc.gsfc.nasa.gov/planetary/factsheet, the Sun's from
  // its own sheet.
  readonly diameterKm: number;
  readonly day: string;
  readonly year: string;
  readonly moons: string;
  readonly gravity: number;
  readonly temperature: string;

  /** Sidereal rotation, in hours; negative turns backwards (retrograde). */
  readonly rotationHours: number;
  /**
   * Its north pole in the sky, as right ascension and declination (degrees,
   * J2000), from the IAU's report on cartographic coordinates. Sets which
   * way the axis leans, so Saturn's rings face the Sun as they do today.
   */
  readonly pole: readonly [ra: number, dec: number];

  // How the orrery draws it. Not to scale: the arms are spaced evenly so
  // every planet can be seen and tapped, as a real orrery's are.
  /** The arm's length, in scene units (the Sun's radius is 0.46). */
  readonly arm: number;
  /** Its radius on the orrery, in scene units. */
  readonly radius: number;
  readonly surface: Surface;
};

export const BODIES: readonly Body[] = [
  {
    id: 'sun',
    name: 'Sun',
    numeral: '',
    kind: 'A yellow dwarf star',
    note: 'It holds 99.8% of the solar system’s mass.',
    diameterKm: 1_391_400,
    day: '25.4 days',
    year: '—',
    moons: '8 planets',
    gravity: 274,
    temperature: '5,500 °C at the surface',
    rotationHours: 609.12,
    pole: [286.13, 63.87],
    arm: 0,
    radius: 0.46,
    surface: 'sun',
  },
  {
    id: 'mercury',
    name: 'Mercury',
    numeral: 'I',
    kind: 'The first planet',
    note: 'The smallest planet, cratered like the Moon.',
    diameterKm: 4879,
    day: '176 days',
    year: '88.0 days',
    moons: 'None',
    gravity: 3.7,
    temperature: '167 °C',
    rotationHours: 1407.6,
    pole: [281.01, 61.41],
    arm: 1.08,
    radius: 0.09,
    surface: 'rocky',
  },
  {
    id: 'venus',
    name: 'Venus',
    numeral: 'II',
    kind: 'The second planet',
    note: 'The hottest planet, under clouds of sulfuric acid. It turns backwards.',
    diameterKm: 12_104,
    day: '117 days',
    year: '224.7 days',
    moons: 'None',
    gravity: 8.9,
    temperature: '464 °C',
    rotationHours: -5832.5,
    pole: [272.76, 67.16],
    arm: 1.5,
    radius: 0.15,
    surface: 'venus',
  },
  {
    id: 'earth',
    name: 'Earth',
    numeral: 'III',
    kind: 'The third planet',
    note: 'Our home: the only world known to hold life.',
    diameterKm: 12_756,
    day: '24 hours',
    year: '365.2 days',
    moons: '1',
    gravity: 9.8,
    temperature: '15 °C',
    rotationHours: 23.9345,
    pole: [0, 90],
    arm: 1.95,
    radius: 0.155,
    surface: 'earth',
  },
  {
    id: 'mars',
    name: 'Mars',
    numeral: 'IV',
    kind: 'The fourth planet',
    note: 'A cold desert, home to Olympus Mons, the tallest volcano known.',
    diameterKm: 6792,
    day: '24.7 hours',
    year: '687 days',
    moons: '2',
    gravity: 3.7,
    temperature: '−65 °C',
    rotationHours: 24.6,
    pole: [317.68, 52.89],
    arm: 2.4,
    radius: 0.115,
    surface: 'rocky',
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    numeral: 'V',
    kind: 'The fifth planet',
    note: 'The largest planet. Its Great Red Spot is a storm wider than Earth.',
    diameterKm: 142_984,
    day: '9.9 hours',
    year: '11.9 years',
    moons: '95',
    gravity: 23.1,
    temperature: '−110 °C',
    rotationHours: 9.925,
    pole: [268.05, 64.49],
    arm: 2.95,
    radius: 0.34,
    surface: 'banded',
  },
  {
    id: 'saturn',
    name: 'Saturn',
    numeral: 'VI',
    kind: 'The sixth planet',
    note: 'Its rings are mostly water ice: 270,000 km across, and in most places about 10 m thick.',
    diameterKm: 120_536,
    day: '10.7 hours',
    year: '29.4 years',
    moons: '274',
    gravity: 9.0,
    temperature: '−140 °C',
    rotationHours: 10.656,
    pole: [40.59, 83.54],
    arm: 3.72,
    radius: 0.29,
    surface: 'banded',
  },
  {
    id: 'uranus',
    name: 'Uranus',
    numeral: 'VII',
    kind: 'The seventh planet',
    note: 'An ice giant that rolls around the Sun on its side, tipped 98°.',
    diameterKm: 51_118,
    day: '17.2 hours',
    year: '83.7 years',
    moons: '28',
    gravity: 8.7,
    temperature: '−195 °C',
    rotationHours: -17.24,
    pole: [257.31, -15.18],
    arm: 4.32,
    radius: 0.21,
    surface: 'ice-giant',
  },
  {
    id: 'neptune',
    name: 'Neptune',
    numeral: 'VIII',
    kind: 'The eighth planet',
    note: 'The windiest world: its storms blow faster than 2,000 km/h.',
    diameterKm: 49_528,
    day: '16.1 hours',
    year: '163.7 years',
    moons: '16',
    gravity: 11.0,
    temperature: '−200 °C',
    rotationHours: 16.11,
    pole: [299.36, 43.46],
    arm: 4.82,
    radius: 0.205,
    surface: 'ice-giant',
  },
];

export const bodyById = (id: BodyId): Body =>
  BODIES.find((body) => body.id === id)!;

export const PLANETS = BODIES.filter(
  (body): body is Body & { id: PlanetId } => body.id !== 'sun',
);
