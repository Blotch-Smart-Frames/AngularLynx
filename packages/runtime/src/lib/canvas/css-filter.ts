// cspell:words currentcolor
import { type RGBA, parseColor } from './css-color';

/**
 * The CSS `filter` value list, as the 2D context's `filter` takes it:
 * `blur()`, `brightness()`, `contrast()`, `drop-shadow()`, `grayscale()`,
 * `hue-rotate()`, `invert()`, `opacity()`, `saturate()` and `sepia()`, in
 * any order, or `none`. Parsed here, so the shells get steps they apply to
 * the pixels of what's drawn, as `font` is parsed for them: a blur, a color
 * matrix, or a drop shadow. A string that isn't a filter leaves `filter` as
 * it was, as in browsers.
 *
 * The color functions are worked out here as the 4x5 matrices Filter
 * Effects gives their SVG equivalents, so the shells apply any of them with
 * one loop. Each step clamps, as each of the SVG primitives does, so
 * `brightness(2) contrast(0.5)` isn't the same as one matrix of the two.
 *
 * The step list crosses the bridge as one array of numbers:
 * - `FILTER_STEP.blur`, σ: a Gaussian blur, σ its standard deviation in the
 *   canvas's pixels.
 * - `FILTER_STEP.matrix`, then 20 numbers: a color matrix, row by row (red,
 *   green, blue, alpha), each row's red, green, blue and alpha factors and
 *   its offset, on colors 0 to 1 that aren't premultiplied.
 * - `FILTER_STEP.dropShadow`, dx, dy, σ, red, green, blue (0 to 255),
 *   alpha (0 to 1): the alpha of what's drawn so far, blurred, in the
 *   color, moved by dx and dy, under it.
 */
export type CanvasFilter = {
  /** The steps, in order, as they cross the bridge (above). */
  readonly steps: readonly number[];
  /**
   * How far, in the canvas's pixels, the steps can move what's drawn: a
   * blur's or a shadow's reach. The shells draw into a layer this much
   * bigger than the canvas on every side, so a shape just off the canvas
   * still blurs or casts its shadow onto it.
   */
  readonly padding: number;
};

export const FILTER_STEP = {
  blur: 0,
  matrix: 1,
  dropShadow: 2,
} as const;

/** `filter = 'none'`, which is also what `url()` amounts to (see below). */
export const NO_FILTER: CanvasFilter = { steps: [], padding: 0 };

/**
 * The most the layer grows by on a side. A blur's reach is three of its
 * deviations, so a big blur (`blur(500px)`) would make a layer many times
 * the canvas's size; past this, what's farther off the canvas is left out.
 */
const MAX_PADDING = 256;

/**
 * What `em` and `rem` are of: a canvas's font size, which is the page's
 * 16px, as no style reaches a canvas's context on Lynx (as in css-font.ts).
 */
const BASE_SIZE = 16;

const LENGTH_UNITS: Record<string, number> = {
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  em: BASE_SIZE,
  rem: BASE_SIZE,
};

const ANGLE_UNITS: Record<string, number> = {
  deg: Math.PI / 180,
  grad: Math.PI / 200,
  rad: 1,
  turn: Math.PI * 2,
};

/**
 * A table's own entry for a name, so a name like `constructor` (in
 * `constructor()` or `1constructor`) isn't found on Object's prototype.
 * hasOwnProperty rather than Object.hasOwn, which older engines lack.
 */
const own = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

const NUMBER = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-z%]*)$/;

/**
 * A `<length>` in the canvas's pixels: a number with a unit, or a bare 0.
 */
const lengthOf = (token: string): number | null => {
  const match = NUMBER.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  if (match[2] === '') return value === 0 ? 0 : null;
  const unit = own(LENGTH_UNITS, match[2]);
  return unit === undefined ? null : value * unit;
};

/**
 * An `<angle>` in radians: a number with a unit, or a bare 0.
 */
const angleOf = (token: string): number | null => {
  const match = NUMBER.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  if (match[2] === '') return value === 0 ? 0 : null;
  const unit = own(ANGLE_UNITS, match[2]);
  return unit === undefined ? null : value * unit;
};

/**
 * A `<number>` or a `<percentage>`, as a number: 50% is 0.5.
 */
const amountOf = (token: string): number | null => {
  const match = NUMBER.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  if (match[2] === '') return value;
  return match[2] === '%' ? value / 100 : null;
};

/**
 * The arguments' tokens, split at the whitespace outside parentheses, so a
 * color like `rgba(0, 0, 0, 0.5)` stays one token.
 */
const tokensOf = (text: string): string[] => {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth === 0 && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
};

type Matrix = readonly number[];

/**
 * feColorMatrix's `saturate`, as saturate() is.
 */
const saturateMatrix = (s: number): Matrix => [
  0.213 + 0.787 * s,
  0.715 - 0.715 * s,
  0.072 - 0.072 * s,
  0,
  0,
  0.213 - 0.213 * s,
  0.715 + 0.285 * s,
  0.072 - 0.072 * s,
  0,
  0,
  0.213 - 0.213 * s,
  0.715 - 0.715 * s,
  0.072 + 0.928 * s,
  0,
  0,
  0,
  0,
  0,
  1,
  0,
];

/**
 * feColorMatrix's `hueRotate`, as hue-rotate() is.
 */
const hueRotateMatrix = (angle: number): Matrix => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    0.213 + cos * 0.787 - sin * 0.213,
    0.715 - cos * 0.715 - sin * 0.715,
    0.072 - cos * 0.072 + sin * 0.928,
    0,
    0,
    0.213 - cos * 0.213 + sin * 0.143,
    0.715 + cos * 0.285 + sin * 0.14,
    0.072 - cos * 0.072 - sin * 0.283,
    0,
    0,
    0.213 - cos * 0.213 - sin * 0.787,
    0.715 - cos * 0.715 + sin * 0.715,
    0.072 + cos * 0.928 + sin * 0.072,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
};

/**
 * The matrix that scales red, green and blue by `slope` and adds `intercept`.
 */
const linearMatrix = (slope: number, intercept: number): Matrix => [
  slope,
  0,
  0,
  0,
  intercept,
  0,
  slope,
  0,
  0,
  intercept,
  0,
  0,
  slope,
  0,
  intercept,
  0,
  0,
  0,
  1,
  0,
];

/**
 * The color matrix of each color function, from its amount (already
 * defaulted and clamped).
 */
const MATRICES: Record<string, (amount: number) => Matrix> = {
  // feFuncR/G/B type="linear" slope="[amount]".
  brightness: (a) => linearMatrix(a, 0),
  // slope="[amount]" intercept="-(0.5 * [amount]) + 0.5".
  contrast: (a) => linearMatrix(a, 0.5 - 0.5 * a),
  grayscale: (a) => {
    const g = 1 - a;
    return [
      0.2126 + 0.7874 * g,
      0.7152 - 0.7152 * g,
      0.0722 - 0.0722 * g,
      0,
      0,
      0.2126 - 0.2126 * g,
      0.7152 + 0.2848 * g,
      0.0722 - 0.0722 * g,
      0,
      0,
      0.2126 - 0.2126 * g,
      0.7152 - 0.7152 * g,
      0.0722 + 0.9278 * g,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
    ];
  },
  // A table of [amount, 1 - amount]: amount + C * (1 - 2 * amount).
  invert: (a) => linearMatrix(1 - 2 * a, a),
  // feFuncA type="table" tableValues="0 [amount]".
  opacity: (a) => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, a, 0],
  saturate: saturateMatrix,
  sepia: (a) => {
    const g = 1 - a;
    return [
      0.393 + 0.607 * g,
      0.769 - 0.769 * g,
      0.189 - 0.189 * g,
      0,
      0,
      0.349 - 0.349 * g,
      0.686 + 0.314 * g,
      0.168 - 0.168 * g,
      0,
      0,
      0.272 - 0.272 * g,
      0.534 - 0.534 * g,
      0.131 + 0.869 * g,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
    ];
  },
};

/** The functions whose amount over 100% is clamped to 1, as the spec has it. */
const CLAMPED = new Set(['grayscale', 'invert', 'opacity', 'sepia']);

/**
 * A blur's reach: three deviations take in all but a sliver of it.
 */
const reachOf = (sigma: number): number => Math.ceil(sigma * 3);

type Step = { readonly steps: number[]; readonly padding: number };

/**
 * One filter function's steps, or null if its arguments are malformed.
 */
const stepOf = (name: string, args: string[]): Step | null => {
  if (name === 'blur') {
    if (args.length > 1) return null;
    const sigma = args.length ? lengthOf(args[0]) : 0;
    if (sigma === null || sigma < 0) return null;
    return { steps: [FILTER_STEP.blur, sigma], padding: reachOf(sigma) };
  }
  if (name === 'hue-rotate') {
    if (args.length > 1) return null;
    const angle = args.length ? angleOf(args[0]) : 0;
    if (angle === null) return null;
    return {
      steps: [FILTER_STEP.matrix, ...hueRotateMatrix(angle)],
      padding: 0,
    };
  }
  if (name === 'drop-shadow') return dropShadowOf(args);
  const matrix = own(MATRICES, name);
  if (!matrix || args.length > 1) return null;
  const amount = args.length ? amountOf(args[0]) : 1;
  if (amount === null || amount < 0) return null;
  return {
    steps: [
      FILTER_STEP.matrix,
      ...matrix(CLAMPED.has(name) ? Math.min(amount, 1) : amount),
    ],
    padding: 0,
  };
};

/**
 * `drop-shadow(<color>? && <length>{2,3})`: the color before or after the
 * lengths, black (the canvas's `currentcolor`) when it's left out.
 */
const dropShadowOf = (args: string[]): Step | null => {
  const lengths: number[] = [];
  let color: RGBA | null = null;
  let colorAt = -1;
  for (const [index, token] of args.entries()) {
    const length = lengthOf(token);
    if (length !== null) {
      lengths.push(length);
      continue;
    }
    // One color, only before the first length or after the last.
    if (color !== null) return null;
    color = parseColor(token);
    if (color === null) return null;
    colorAt = index;
  }
  if (lengths.length < 2 || lengths.length > 3) return null;
  if (colorAt > 0 && colorAt < args.length - 1) return null;
  const [dx, dy, sigma = 0] = lengths;
  if (sigma < 0) return null;
  const [r, g, b, a] = color ?? [0, 0, 0, 1];
  return {
    steps: [FILTER_STEP.dropShadow, dx, dy, sigma, r, g, b, a],
    padding: reachOf(sigma) + Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))),
  };
};

/**
 * The filter a `filter` string sets, or null if it isn't one (`filter`
 * stays as it was then).
 *
 * `url()`, which names an SVG `<filter>`, is taken, but Lynx has no SVG
 * filters for it to find, and a filter list that names one that isn't
 * there isn't applied at all, as the spec has it: so the whole list is no
 * filter.
 */
export const parseFilter = (value: unknown): CanvasFilter | null => {
  const text = String(value).trim().toLowerCase();
  if (text === 'none') return NO_FILTER;
  const steps: number[] = [];
  let padding = 0;
  let references = false;
  let index = 0;
  while (index < text.length) {
    // The text is trimmed, so a function always follows the whitespace.
    while (/\s/.test(text[index])) index++;
    const name = /^[a-z-]+\(/.exec(text.slice(index));
    if (!name) return null;
    // Up to the parenthesis that closes it.
    let depth = 0;
    let end = index + name[0].length - 1;
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++;
      if (text[end] === ')' && --depth === 0) break;
    }
    if (end >= text.length) return null;
    const functionName = name[0].slice(0, -1);
    const inside = text.slice(index + name[0].length, end);
    index = end + 1;
    if (functionName === 'url') {
      references = true;
      continue;
    }
    const step = stepOf(functionName, tokensOf(inside));
    if (!step) return null;
    steps.push(...step.steps);
    padding += step.padding;
  }
  // An empty string isn't a filter.
  if (steps.length === 0 && !references) return null;
  if (references) return NO_FILTER;
  return { steps, padding: Math.min(padding, MAX_PADDING) };
};
