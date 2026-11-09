/**
 * What the darkroom does to a photo: one look (a film stock's character) and
 * the adjustments on top of it. Plain numbers, so a photo's development saves
 * to storage as JSON and the shader takes it as uniforms.
 */
export type Development = {
  /** The look's id (see looks.ts). */
  readonly look: string;
  readonly adjustments: Adjustments;
};

/** The adjustments the controls set, each 0 when untouched. */
export type Adjustments = {
  /** In stops, -2 to +2. */
  readonly exposure: number;
  /** -1 to 1. */
  readonly contrast: number;
  /** -1 to 1. */
  readonly highlights: number;
  /** -1 to 1. */
  readonly shadows: number;
  /** -1 (cool) to 1 (warm). */
  readonly temperature: number;
  /** -1 (green) to 1 (magenta). */
  readonly tint: number;
  /** -1 (gray) to 1. */
  readonly saturation: number;
  /** 0 to 1. */
  readonly fade: number;
  /** 0 to 1. */
  readonly grain: number;
  /** 0 to 1. */
  readonly halation: number;
  /** 0 to 1. */
  readonly vignette: number;
};

export type AdjustmentKey = keyof Adjustments;

/** One control: what it's called, its range, and how its value reads. */
export type AdjustmentSpec = {
  readonly key: AdjustmentKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /** How the readout shows a value. */
  readonly format: (value: number) => string;
};

const signed = (value: number, digits = 0): string => {
  const shown = (value * 100).toFixed(digits);
  return value > 0 ? `+${shown}` : shown === '-0' ? '0' : shown;
};

/**
 * Exposure reads in stops, as a light meter does.
 */
const stops = (value: number): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(1)} EV`;

const percent = (value: number): string => `${Math.round(value * 100)}`;

/**
 * The controls, in the order a printer works: light, then tone, then color,
 * then the film's own character.
 */
export const ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, format: stops },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, format: signed },
  { key: 'highlights', label: 'Highlights', min: -1, max: 1, format: signed },
  { key: 'shadows', label: 'Shadows', min: -1, max: 1, format: signed },
  { key: 'temperature', label: 'Warmth', min: -1, max: 1, format: signed },
  { key: 'tint', label: 'Tint', min: -1, max: 1, format: signed },
  { key: 'saturation', label: 'Color', min: -1, max: 1, format: signed },
  { key: 'fade', label: 'Fade', min: 0, max: 1, format: percent },
  { key: 'grain', label: 'Grain', min: 0, max: 1, format: percent },
  { key: 'halation', label: 'Halation', min: 0, max: 1, format: percent },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, format: percent },
];

export const NEUTRAL: Adjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  fade: 0,
  grain: 0,
  halation: 0,
  vignette: 0,
};

/** Reads a saved development back, filling anything a newer app added. */
export const readDevelopment = (value: unknown): Development | null => {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Partial<Development>;
  if (typeof saved.look !== 'string') return null;
  const adjustments = { ...NEUTRAL };
  for (const spec of ADJUSTMENTS) {
    const number = (saved.adjustments as Record<string, unknown> | undefined)?.[
      spec.key
    ];
    if (typeof number === 'number' && Number.isFinite(number)) {
      adjustments[spec.key] = Math.min(spec.max, Math.max(spec.min, number));
    }
  }
  return { look: saved.look, adjustments };
};
