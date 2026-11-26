/**
 * The CSS `font` shorthand, as the 2D context's `font` takes it:
 * `[style] [variant] [weight] [stretch] size[/line-height] family, …`.
 * Parsed here, so the shells get the parts they draw with (italic, weight,
 * size in pixels, families), and the getter gives back the browser's
 * serialization. A string that isn't a font leaves `font` as it was.
 */
export type CanvasFont = {
  readonly italic: boolean;
  readonly smallCaps: boolean;
  /** 1 to 1000; 400 is normal, 700 bold. */
  readonly weight: number;
  /** In the canvas's pixels. */
  readonly size: number;
  /** In order, without quotes. */
  readonly families: readonly string[];
  /** What `font` reads back. */
  readonly text: string;
};

/**
 * The size `em`, `rem` and the percentages are of: a canvas's font size,
 * which is the page's 16px, as no style reaches a canvas's context on Lynx.
 */
const BASE_SIZE = 16;

const ABSOLUTE_SIZES: Record<string, number> = {
  'xx-small': 9,
  'x-small': 10,
  small: 13,
  medium: 16,
  large: 18,
  'x-large': 24,
  'xx-large': 32,
  'xxx-large': 48,
};

const UNITS: Record<string, number> = {
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  em: BASE_SIZE,
  rem: BASE_SIZE,
  '%': BASE_SIZE / 100,
};

const STRETCHES = new Set([
  'ultra-condensed',
  'extra-condensed',
  'condensed',
  'semi-condensed',
  'semi-expanded',
  'expanded',
  'extra-expanded',
  'ultra-expanded',
]);

/** The system fonts CSS names, drawn in the system's font as Chrome does. */
const SYSTEM_FONTS = new Set([
  'caption',
  'icon',
  'menu',
  'message-box',
  'small-caption',
  'status-bar',
]);

const sizeOf = (token: string): number | null => {
  if (token in ABSOLUTE_SIZES) return ABSOLUTE_SIZES[token];
  if (token === 'larger') return BASE_SIZE * 1.2;
  if (token === 'smaller') return BASE_SIZE / 1.2;
  const match =
    /^(\d*\.?\d+(?:e[-+]?\d+)?)(px|pt|pc|in|cm|mm|q|em|rem|%)$/.exec(token);
  if (!match) return null;
  return Number(match[1]) * UNITS[match[2]];
};

/**
 * The families after the size, or null if the list is malformed.
 */
const familiesOf = (text: string): string[] | null => {
  const families: string[] = [];
  for (const part of text.split(',')) {
    const family = part.trim();
    if (family === '') return null;
    const quoted = /^(["'])(.*)\1$/.exec(family);
    if (quoted) {
      families.push(quoted[2]);
    } else if (/^[-\w\s]+$/.test(family) && !/^\d/.test(family)) {
      // An unquoted family is identifiers separated by spaces.
      families.push(family.replace(/\s+/g, ' '));
    } else {
      return null;
    }
  }
  return families;
};

const formatNumber = (value: number): string =>
  String(Math.round(value * 1000) / 1000);

export const parseFont = (value: unknown): CanvasFont | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (SYSTEM_FONTS.has(text.toLowerCase())) {
    return {
      italic: false,
      smallCaps: false,
      weight: 400,
      size: 13,
      families: ['system-ui'],
      text: '13px system-ui',
    };
  }
  // The keywords and the size come first, up to the first space after the
  // size; the families are everything after.
  const tokens = text.split(/\s+/);
  let italic = false;
  let smallCaps = false;
  let weight = 400;
  const prefix: string[] = [];
  let index = 0;
  let size: number | null = null;
  for (; index < tokens.length; index++) {
    const token = tokens[index].toLowerCase();
    if (token === 'normal') continue;
    if (token === 'italic' || token === 'oblique') {
      italic = true;
      prefix.push(token);
    } else if (token === 'small-caps') {
      smallCaps = true;
      prefix.push(token);
    } else if (token === 'bold' || token === 'bolder') {
      weight = 700;
      prefix.push('bold');
    } else if (token === 'lighter') {
      weight = 100;
      prefix.push(token);
    } else if (
      /^\d+$/.test(token) &&
      Number(token) >= 1 &&
      Number(token) <= 1000
    ) {
      weight = Number(token);
      if (weight !== 400) prefix.push(weight === 700 ? 'bold' : token);
    } else if (STRETCHES.has(token)) {
      prefix.push(token);
    } else {
      // The size, with a line height the canvas ignores.
      size = sizeOf(token.split('/')[0]);
      break;
    }
  }
  if (size === null || !Number.isFinite(size) || size < 0) return null;
  const families = familiesOf(tokens.slice(index + 1).join(' '));
  if (!families) return null;
  const familyText = families
    .map((family) =>
      /[^-\w]/.test(family) || /^\d/.test(family) ? `"${family}"` : family,
    )
    .join(', ');
  return {
    italic,
    smallCaps,
    weight,
    size,
    families,
    text: [...prefix, `${formatNumber(size)}px`, familyText].join(' '),
  };
};

/** The 2D context's font until the app sets one. */
export const DEFAULT_FONT: CanvasFont = {
  italic: false,
  smallCaps: false,
  weight: 400,
  size: 10,
  families: ['sans-serif'],
  text: '10px sans-serif',
};
