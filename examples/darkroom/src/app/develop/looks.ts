// cspell:words halation

/**
 * The film looks. Each is the app's own invention, named for what it does,
 * not after a real stock: a look is a set of tone curves (how each color
 * layer of the film answers light) and the character the stock brings with
 * it (grain, glow, fade), which the person's adjustments then add to.
 */
export type Look = {
  readonly id: string;
  readonly name: string;
  /** The speed printed on the box: what kind of light it was made for. */
  readonly iso: number;
  /** What it's for, in a line. */
  readonly note: string;
  /**
   * Each channel's curve as [input, output] points from 0 to 1, read with a
   * monotone cubic (see curves.ts), so a curve never folds back on itself.
   */
  readonly curves: {
    readonly r: readonly (readonly [number, number])[];
    readonly g: readonly (readonly [number, number])[];
    readonly b: readonly (readonly [number, number])[];
  };
  /** What the stock adds before any adjustment: 0 when it adds nothing. */
  readonly character: {
    readonly contrast?: number;
    readonly saturation?: number;
    readonly temperature?: number;
    readonly fade?: number;
    readonly grain?: number;
    readonly halation?: number;
    readonly vignette?: number;
    /** 1 for black and white. */
    readonly monochrome?: number;
  };
};

const LINEAR = [
  [0, 0],
  [1, 1],
] as const;

export const LOOKS: readonly Look[] = [
  {
    id: 'straight',
    name: 'Straight',
    iso: 100,
    note: 'No stock: the photo as the camera made it.',
    curves: { r: LINEAR, g: LINEAR, b: LINEAR },
    character: {},
  },
  {
    id: 'harbor',
    name: 'Harbor',
    iso: 400,
    note: 'A soft negative for people: warm skin, open shadows, gentle highlights.',
    curves: {
      r: [
        [0, 0.04],
        [0.25, 0.27],
        [0.5, 0.54],
        [0.8, 0.83],
        [1, 0.97],
      ],
      g: [
        [0, 0.035],
        [0.25, 0.26],
        [0.5, 0.51],
        [0.8, 0.8],
        [1, 0.96],
      ],
      b: [
        [0, 0.05],
        [0.25, 0.24],
        [0.5, 0.47],
        [0.8, 0.77],
        [1, 0.93],
      ],
    },
    character: {
      contrast: -0.12,
      saturation: -0.08,
      grain: 0.18,
      halation: 0.12,
    },
  },
  {
    id: 'signal',
    name: 'Signal',
    iso: 50,
    note: 'A slide film: deep blacks, dense color, nothing forgiven.',
    curves: {
      r: [
        [0, 0],
        [0.2, 0.13],
        [0.5, 0.5],
        [0.8, 0.88],
        [1, 1],
      ],
      g: [
        [0, 0],
        [0.2, 0.14],
        [0.5, 0.5],
        [0.8, 0.87],
        [1, 1],
      ],
      b: [
        [0, 0.02],
        [0.2, 0.17],
        [0.5, 0.52],
        [0.8, 0.86],
        [1, 0.98],
      ],
    },
    character: { contrast: 0.1, saturation: 0.18, grain: 0.06, vignette: 0.2 },
  },
  {
    id: 'ember',
    name: 'Ember',
    iso: 800,
    note: 'For night streets: tungsten-balanced, cool shadows, lights that bloom red.',
    curves: {
      r: [
        [0, 0.02],
        [0.3, 0.28],
        [0.6, 0.62],
        [1, 1],
      ],
      g: [
        [0, 0.03],
        [0.3, 0.3],
        [0.6, 0.6],
        [1, 0.97],
      ],
      b: [
        [0, 0.08],
        [0.3, 0.35],
        [0.6, 0.6],
        [1, 0.9],
      ],
    },
    character: {
      temperature: -0.18,
      saturation: 0.05,
      grain: 0.38,
      halation: 0.55,
    },
  },
  {
    id: 'pewter',
    name: 'Pewter',
    iso: 400,
    note: 'Black and white with a full scale of grays and a visible grain.',
    curves: {
      r: [
        [0, 0.02],
        [0.25, 0.2],
        [0.5, 0.5],
        [0.75, 0.8],
        [1, 0.98],
      ],
      g: [
        [0, 0.02],
        [0.25, 0.2],
        [0.5, 0.5],
        [0.75, 0.8],
        [1, 0.98],
      ],
      b: [
        [0, 0.02],
        [0.25, 0.2],
        [0.5, 0.5],
        [0.75, 0.8],
        [1, 0.98],
      ],
    },
    character: { monochrome: 1, contrast: 0.1, grain: 0.42, vignette: 0.12 },
  },
  {
    id: 'bypass',
    name: 'Bypass',
    iso: 200,
    note: 'Silver left in the print: hard contrast, color drained to metal.',
    curves: {
      r: [
        [0, 0],
        [0.3, 0.22],
        [0.7, 0.8],
        [1, 1],
      ],
      g: [
        [0, 0],
        [0.3, 0.23],
        [0.7, 0.8],
        [1, 1],
      ],
      b: [
        [0, 0.01],
        [0.3, 0.25],
        [0.7, 0.79],
        [1, 0.98],
      ],
    },
    character: { contrast: 0.28, saturation: -0.55, grain: 0.22 },
  },
  {
    id: 'crossed',
    name: 'Crossed',
    iso: 160,
    note: 'Developed in the wrong chemistry: cyan shadows, yellow light.',
    curves: {
      r: [
        [0, 0],
        [0.25, 0.18],
        [0.6, 0.66],
        [1, 1],
      ],
      g: [
        [0, 0.06],
        [0.25, 0.28],
        [0.6, 0.66],
        [1, 1],
      ],
      b: [
        [0, 0.14],
        [0.25, 0.3],
        [0.6, 0.52],
        [1, 0.78],
      ],
    },
    character: { contrast: 0.08, saturation: 0.2, fade: 0.08, grain: 0.15 },
  },
  {
    id: 'matte',
    name: 'Matte',
    iso: 160,
    note: 'Printed on matte paper: blacks lifted to a warm gray, colors hushed.',
    curves: {
      r: [
        [0, 0.1],
        [0.5, 0.52],
        [1, 0.95],
      ],
      g: [
        [0, 0.09],
        [0.5, 0.5],
        [1, 0.94],
      ],
      b: [
        [0, 0.09],
        [0.5, 0.48],
        [1, 0.9],
      ],
    },
    character: { saturation: -0.2, fade: 0.25, grain: 0.1 },
  },
];

export const lookById = (id: string): Look =>
  LOOKS.find((look) => look.id === id) ?? LOOKS[0]!;
