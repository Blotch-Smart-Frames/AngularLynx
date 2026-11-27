/**
 * The commands of the 2D context's bridge (see canvas-2d-context.ts): the
 * calls the context records, each an opcode followed by its arguments, which
 * the shells' `AngularLynxWebGL` module runs in `run2D`. The shells read the
 * same numbers: packages/native generates its `AngularLynxCanvas2DOps.h` and
 * `Canvas2DOps.kt` from this file (`npm run generate:webgl-ops -w
 * packages/native`), and a test there fails when they differ.
 *
 * Commands numbered below 200 return nothing and run in order. Queries, from
 * 200 on, each add one result to what `run2D` returns.
 *
 * Paths cross as one array of numbers in the canvas's pixels, already
 * transformed (see path.ts): PATH_OP below, each followed by its points.
 * A gradient crosses whole with the style that paints with it: its type
 * (0 linear, 1 radial, 2 conic), six numbers, and its stops as one array of
 * offset, red, green, blue, alpha. A pattern's image is made once in the
 * shell (`createPattern`), and its transform crosses with the style.
 * A filter crosses as its steps, in one array (see css-filter.ts).
 */
export const OP = {
  save: 1,
  restore: 2,
  reset: 3,
  resize: 4,
  present: 5,
  setTransform: 10,
  setGlobalAlpha: 11,
  setCompositeOperation: 12,
  setFillColor: 13,
  setFillGradient: 14,
  setFillPattern: 15,
  setStrokeColor: 16,
  setStrokeGradient: 17,
  setStrokePattern: 18,
  setLineWidth: 19,
  setLineCap: 20,
  setLineJoin: 21,
  setMiterLimit: 22,
  setLineDash: 23,
  setShadow: 24,
  setFont: 25,
  setTextAlign: 26,
  setTextBaseline: 27,
  setDirection: 28,
  setLetterSpacing: 29,
  setImageSmoothing: 30,
  setFilter: 31,
  createPattern: 44,
  releaseObject: 46,
  clearPath: 50,
  fill: 51,
  stroke: 52,
  clip: 53,
  fillText: 54,
  strokeText: 55,
  drawImage: 56,
  putImageData: 57,
  measureText: 200,
  getImageData: 201,
  isPointInPath: 202,
  isPointInStroke: 203,
} as const;

/** The segments of a path as it crosses the bridge. */
export const PATH_OP = {
  /** x y */
  moveTo: 0,
  /** x y */
  lineTo: 1,
  /** cpx cpy x y */
  quadTo: 2,
  /** cp1x cp1y cp2x cp2y x y */
  cubicTo: 3,
  close: 4,
} as const;

/**
 * globalCompositeOperation's values, by the number the shells take. The
 * first eleven are Porter-Duff operators, the rest blend modes.
 */
export const COMPOSITE_OPERATIONS = [
  'source-over',
  'source-in',
  'source-out',
  'source-atop',
  'destination-over',
  'destination-in',
  'destination-out',
  'destination-atop',
  'lighter',
  'copy',
  'xor',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export const LINE_CAPS = ['butt', 'round', 'square'] as const;
export const LINE_JOINS = ['miter', 'round', 'bevel'] as const;
export const TEXT_ALIGNS = ['start', 'end', 'left', 'right', 'center'] as const;
export const TEXT_BASELINES = [
  'top',
  'hanging',
  'middle',
  'alphabetic',
  'ideographic',
  'bottom',
] as const;
export const DIRECTIONS = ['ltr', 'rtl', 'inherit'] as const;
export const PATTERN_REPETITIONS = [
  'repeat',
  'repeat-x',
  'repeat-y',
  'no-repeat',
] as const;
export const SMOOTHING_QUALITIES = ['low', 'medium', 'high'] as const;
