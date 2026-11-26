// cspell:words fangsong
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
 * The CSS-wide keywords, which can't be a family unquoted, and the generic
 * families, which mean the generic family only unquoted.
 */
const RESERVED_FAMILIES = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'default',
]);
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

type Family = { readonly name: string; readonly quoted: boolean };

/**
 * CSS's whitespace: spaces, tabs and line breaks.
 */
const isSpace = (char: string | undefined): boolean =>
  char !== undefined && /\s/.test(char);

/**
 * The families after the size, split at the commas outside quotes, or null
 * if the list is malformed.
 */
const familiesOf = (text: string): Family[] | null => {
  const families: Family[] = [];
  let index = 0;
  while (true) {
    while (isSpace(text[index])) index++;
    const quote = text[index];
    if (quote === '"' || quote === "'") {
      // A CSS string: up to the quote that isn't escaped, with its escapes
      // read (`\"`, `\\`, and hex code points like `\41 `).
      let name = '';
      index++;
      while (index < text.length && text[index] !== quote) {
        if (text[index] === '\\') {
          const hex = /^[0-9a-f]{1,6}\s?/i.exec(text.slice(index + 1));
          if (hex) {
            name += String.fromCodePoint(
              Math.min(0x10ffff, parseInt(hex[0], 16)) || 0xfffd,
            );
            index += 1 + hex[0].length;
          } else {
            name += text[index + 1] ?? '';
            index += 2;
          }
        } else {
          name += text[index++];
        }
      }
      if (index >= text.length) return null;
      families.push({ name, quoted: true });
      index++;
    } else {
      // Identifiers separated by spaces, up to the next comma.
      const comma = text.indexOf(',', index);
      const part = text.slice(index, comma < 0 ? text.length : comma).trim();
      if (
        !/^-?[a-z_\u0080-\uffff][-\w\u0080-\uffff]*(?:\s+-?[a-z_\u0080-\uffff][-\w\u0080-\uffff]*)*$/i.test(
          part,
        ) ||
        RESERVED_FAMILIES.has(part.toLowerCase())
      ) {
        return null;
      }
      families.push({ name: part.replace(/\s+/g, ' '), quoted: false });
      index = comma < 0 ? text.length : comma;
    }
    while (isSpace(text[index])) index++;
    if (index >= text.length) return families;
    if (text[index] !== ',') return null;
    index++;
  }
};

/**
 * A family as browsers write it back: quoted when unquoted would differ.
 */
const serializeFamily = ({ name, quoted }: Family): string => {
  const lower = name.toLowerCase();
  const needsQuotes =
    !/^-?[a-z_\u0080-\uffff][-\w\u0080-\uffff]*(?: -?[a-z_\u0080-\uffff][-\w\u0080-\uffff]*)*$/i.test(
      name,
    ) ||
    / /.test(name) ||
    (quoted && (RESERVED_FAMILIES.has(lower) || GENERIC_FAMILIES.has(lower)));
  return needsQuotes ? `"${name.replace(/["\\]/g, '\\$&')}"` : name;
};

/**
 * CSS's `line-height` values: `normal`, a number, a length or a percentage.
 */
const isLineHeight = (token: string): boolean =>
  token === 'normal' ||
  /^(?:\d*\.?\d+(?:e[-+]?\d+)?)(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|%)?$/.test(
    token,
  );

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
  // The tokens before the families: the keywords, the size, and a line
  // height after a slash, with or without spaces round it.
  const tokenPattern = /\s*([^\s/]+|\/)/y;
  const next = (): string | null => {
    const match = tokenPattern.exec(text);
    return match ? match[1] : null;
  };
  let italic = false;
  let smallCaps = false;
  let weight = 400;
  // Each of style, variant, weight and stretch is given once at most, and
  // `normal` stands for one not given.
  const given = new Set<string>();
  let normals = 0;
  const give = (slot: string): boolean => {
    if (given.has(slot)) return false;
    given.add(slot);
    return true;
  };
  const prefix: string[] = [];
  let size: number | null = null;
  for (let raw = next(); raw !== null; raw = next()) {
    const token = raw.toLowerCase();
    if (token === 'normal') {
      normals++;
    } else if (token === 'italic' || token === 'oblique') {
      if (!give('style')) return null;
      italic = true;
      prefix.push(token);
    } else if (token === 'small-caps') {
      if (!give('variant')) return null;
      smallCaps = true;
      prefix.push(token);
    } else if (token === 'bold' || token === 'bolder') {
      if (!give('weight')) return null;
      weight = 700;
      prefix.push('bold');
    } else if (token === 'lighter') {
      if (!give('weight')) return null;
      weight = 100;
      prefix.push(token);
    } else if (
      /^\d+$/.test(token) &&
      Number(token) >= 1 &&
      Number(token) <= 1000
    ) {
      if (!give('weight')) return null;
      weight = Number(token);
      if (weight !== 400) prefix.push(weight === 700 ? 'bold' : token);
    } else if (STRETCHES.has(token)) {
      if (!give('stretch')) return null;
      prefix.push(token);
    } else {
      size = sizeOf(token);
      break;
    }
    if (normals + given.size > 4) return null;
  }
  if (size === null || !Number.isFinite(size)) return null;
  // A line height, which the canvas ignores, but must be one.
  const afterSize = tokenPattern.lastIndex;
  if (next() === '/') {
    const lineHeight = next();
    if (lineHeight === null || !isLineHeight(lineHeight.toLowerCase())) {
      return null;
    }
  } else {
    tokenPattern.lastIndex = afterSize;
  }
  const families = familiesOf(text.slice(tokenPattern.lastIndex));
  if (!families) return null;
  return {
    italic,
    smallCaps,
    weight,
    size,
    families: families.map((family) => family.name),
    text: [
      ...prefix,
      `${formatNumber(size)}px`,
      families.map(serializeFamily).join(', '),
    ].join(' '),
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
