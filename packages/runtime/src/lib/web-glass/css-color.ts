/** A color as red, green, blue and alpha channels, each from 0 to 1. */
export type Rgba = readonly [number, number, number, number];

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/;
const HEX = /^#([0-9a-f]{6})$/i;

/**
 * Parses the two forms a browser hands back for a color it has normalized:
 * six-digit hex (an opaque canvas `fillStyle`) and `rgb()`/`rgba()` (computed
 * styles, a translucent `fillStyle`). Anything else is transparent, so a value
 * the browser couldn't parse draws nothing rather than black.
 */
export const parseNormalizedColor = (value: string): Rgba => {
  const hex = HEX.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const fn = RGB_FUNCTION.exec(value.trim());
  if (!fn) return TRANSPARENT;
  const parts = fn[1]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return TRANSPARENT;
  const [r, g, b, a = 1] = parts as [number, number, number, number?];
  return [r / 255, g / 255, b / 255, a];
};

const cache = new Map<string, Rgba>();
let context: CanvasRenderingContext2D | null | undefined;

/**
 * Resolves any CSS color an author can write (`red`, `#3b82f6`, `rgba(…)`)
 * into channels. A canvas `fillStyle` normalizes the value without touching the
 * DOM or forcing a style recalculation. An invalid value leaves `fillStyle` unchanged,
 * so a sentinel set first tells the two apart.
 */
export const resolveCssColor = (doc: Document, value: string | null): Rgba => {
  if (!value) return TRANSPARENT;
  const cached = cache.get(value);
  if (cached) return cached;
  context ??= doc.createElement('canvas').getContext('2d');
  if (!context) return TRANSPARENT;
  const sentinel = 'rgba(1, 2, 3, 0.5)';
  context.fillStyle = sentinel;
  context.fillStyle = value;
  const normalized = String(context.fillStyle);
  const color =
    normalized === sentinel ? TRANSPARENT : parseNormalizedColor(normalized);
  cache.set(value, color);
  return color;
};

/** Relative luminance, used to pick the light or dark glass material. */
export const luminance = ([r, g, b]: Rgba): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;
