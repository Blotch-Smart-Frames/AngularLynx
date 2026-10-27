import valueParser, {
  type FunctionNode,
  type Node,
} from 'postcss-value-parser';

/**
 * Turns the color functions Tailwind CSS 4 writes into `rgb()`/`rgba()`, the
 * only color functions Lynx parses besides `hsl()` with commas.
 *
 * Tailwind 4's palette is `oklch()`, and its opacity modifiers (`bg-black/50`)
 * are `color-mix(…, transparent)`. Lynx drops both without a warning, so the
 * element renders with no color, while Lynx for Web, which hands the CSS to a
 * browser, shows it: the web preview hides the bug. Lynx also only reads
 * `hsl()` with commas, and Tailwind writes it with spaces.
 *
 * Out-of-gamut colors are mapped into sRGB the way CSS Color 4 says a browser
 * does (reducing chroma in OKLCh), so they match what a browser on an sRGB
 * screen shows rather than clipping each channel.
 */

/** A color in sRGB (channels 0–1, possibly out of gamut) with its alpha. */
type Rgb = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
};

/** A color in OKLab, OKLCh, CIE Lab or CIE LCh, with its alpha. */
type Triple = readonly [number, number, number];

/** The functions this module can evaluate. */
const COLOR_FUNCTIONS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color-mix',
]);

/** The functions this module rewrites; `rgb()` already works on Lynx. */
const LOWERED_FUNCTIONS = new Set(
  [...COLOR_FUNCTIONS].filter((name) => name !== 'rgb' && name !== 'rgba'),
);

/**
 * The CSS named colors, for a `color-mix()` that mixes one. `transparent`
 * is the one Tailwind mixes with.
 */
// cspell:disable -- the CSS named colors and their hex values
const NAMED_COLORS: Record<string, string> = {
  aliceblue: 'f0f8ff',
  antiquewhite: 'faebd7',
  aqua: '00ffff',
  aquamarine: '7fffd4',
  azure: 'f0ffff',
  beige: 'f5f5dc',
  bisque: 'ffe4c4',
  black: '000000',
  blanchedalmond: 'ffebcd',
  blue: '0000ff',
  blueviolet: '8a2be2',
  brown: 'a52a2a',
  burlywood: 'deb887',
  cadetblue: '5f9ea0',
  chartreuse: '7fff00',
  chocolate: 'd2691e',
  coral: 'ff7f50',
  cornflowerblue: '6495ed',
  cornsilk: 'fff8dc',
  crimson: 'dc143c',
  cyan: '00ffff',
  darkblue: '00008b',
  darkcyan: '008b8b',
  darkgoldenrod: 'b8860b',
  darkgray: 'a9a9a9',
  darkgreen: '006400',
  darkgrey: 'a9a9a9',
  darkkhaki: 'bdb76b',
  darkmagenta: '8b008b',
  darkolivegreen: '556b2f',
  darkorange: 'ff8c00',
  darkorchid: '9932cc',
  darkred: '8b0000',
  darksalmon: 'e9967a',
  darkseagreen: '8fbc8f',
  darkslateblue: '483d8b',
  darkslategray: '2f4f4f',
  darkslategrey: '2f4f4f',
  darkturquoise: '00ced1',
  darkviolet: '9400d3',
  deeppink: 'ff1493',
  deepskyblue: '00bfff',
  dimgray: '696969',
  dimgrey: '696969',
  dodgerblue: '1e90ff',
  firebrick: 'b22222',
  floralwhite: 'fffaf0',
  forestgreen: '228b22',
  fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc',
  ghostwhite: 'f8f8ff',
  gold: 'ffd700',
  goldenrod: 'daa520',
  gray: '808080',
  green: '008000',
  greenyellow: 'adff2f',
  grey: '808080',
  honeydew: 'f0fff0',
  hotpink: 'ff69b4',
  indianred: 'cd5c5c',
  indigo: '4b0082',
  ivory: 'fffff0',
  khaki: 'f0e68c',
  lavender: 'e6e6fa',
  lavenderblush: 'fff0f5',
  lawngreen: '7cfc00',
  lemonchiffon: 'fffacd',
  lightblue: 'add8e6',
  lightcoral: 'f08080',
  lightcyan: 'e0ffff',
  lightgoldenrodyellow: 'fafad2',
  lightgray: 'd3d3d3',
  lightgreen: '90ee90',
  lightgrey: 'd3d3d3',
  lightpink: 'ffb6c1',
  lightsalmon: 'ffa07a',
  lightseagreen: '20b2aa',
  lightskyblue: '87cefa',
  lightslategray: '778899',
  lightslategrey: '778899',
  lightsteelblue: 'b0c4de',
  lightyellow: 'ffffe0',
  lime: '00ff00',
  limegreen: '32cd32',
  linen: 'faf0e6',
  magenta: 'ff00ff',
  maroon: '800000',
  mediumaquamarine: '66cdaa',
  mediumblue: '0000cd',
  mediumorchid: 'ba55d3',
  mediumpurple: '9370db',
  mediumseagreen: '3cb371',
  mediumslateblue: '7b68ee',
  mediumspringgreen: '00fa9a',
  mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585',
  midnightblue: '191970',
  mintcream: 'f5fffa',
  mistyrose: 'ffe4e1',
  moccasin: 'ffe4b5',
  navajowhite: 'ffdead',
  navy: '000080',
  oldlace: 'fdf5e6',
  olive: '808000',
  olivedrab: '6b8e23',
  orange: 'ffa500',
  orangered: 'ff4500',
  orchid: 'da70d6',
  palegoldenrod: 'eee8aa',
  palegreen: '98fb98',
  paleturquoise: 'afeeee',
  palevioletred: 'db7093',
  papayawhip: 'ffefd5',
  peachpuff: 'ffdab9',
  peru: 'cd853f',
  pink: 'ffc0cb',
  plum: 'dda0dd',
  powderblue: 'b0e0e6',
  purple: '800080',
  rebeccapurple: '663399',
  red: 'ff0000',
  rosybrown: 'bc8f8f',
  royalblue: '4169e1',
  saddlebrown: '8b4513',
  salmon: 'fa8072',
  sandybrown: 'f4a460',
  seagreen: '2e8b57',
  seashell: 'fff5ee',
  sienna: 'a0522d',
  silver: 'c0c0c0',
  skyblue: '87ceeb',
  slateblue: '6a5acd',
  slategray: '708090',
  slategrey: '708090',
  snow: 'fffafa',
  springgreen: '00ff7f',
  steelblue: '4682b4',
  tan: 'd2b48c',
  teal: '008080',
  thistle: 'd8bfd8',
  tomato: 'ff6347',
  turquoise: '40e0d0',
  violet: 'ee82ee',
  wheat: 'f5deb3',
  white: 'ffffff',
  whitesmoke: 'f5f5f5',
  yellow: 'ffff00',
  yellowgreen: '9acd32',
};
// cspell:enable

/**
 * Rewrites every color function in a declaration value that it can evaluate
 * statically. A function with `var()`, `calc()` or another dynamic part stays
 * as it is: Lynx drops it, as before.
 */
export const lowerColors = (
  value: string,
  channelVariables: ReadonlySet<string> = new Set(),
): string => {
  if (![...LOWERED_FUNCTIONS].some((name) => value.includes(`${name}(`))) {
    return value;
  }
  const parsed = valueParser(value);
  rewriteColorFunctions(parsed.nodes, channelVariables);
  return parsed.toString();
};

const rewriteColorFunctions = (
  nodes: Node[],
  channelVariables: ReadonlySet<string>,
): void => {
  for (const node of nodes) {
    if (node.type !== 'function') {
      continue;
    }
    const name = node.value.toLowerCase();
    const color = LOWERED_FUNCTIONS.has(name) ? parseColor(node) : undefined;
    if (color) {
      // Turning the node into a word replaces the whole function call.
      Object.assign(node, { type: 'word', value: formatRgb(color) });
      continue;
    }
    rewriteColorFunctions(node.nodes, channelVariables);
    const mixed =
      name === 'color-mix'
        ? mixWithChannels(node.nodes, channelVariables)
        : undefined;
    if (mixed) {
      Object.assign(node, { type: 'word', value: mixed });
    }
  }
};

/**
 * Writes `color-mix(in <space>, var(--x) <p>, transparent)`, Tailwind's
 * opacity modifier on a color that is a variable (`bg-primary/50` with the
 * @blotch/ui theme), as `rgba(var(--x-rgb), <p>)` when the stylesheet sets
 * `--x-rgb`, the color's channels with commas (`--primary-rgb: 24, 24, 27`).
 * Lynx substitutes a variable before it parses the color, so that reads as
 * `rgba(24, 24, 27, 0.5)`. Mixing with `transparent` keeps the color and
 * scales its alpha, in any color space. `channelVariables` holds the names
 * the stylesheet sets, without `-rgb`.
 */
const mixWithChannels = (
  nodes: Node[],
  channelVariables: ReadonlySet<string>,
): string | undefined => {
  const parts = splitByComma(nodes);
  if (parts.length !== 3) {
    return undefined;
  }
  const [, first, second] = parts as [Node[], Node[], Node[]];
  const variable = first.find(
    (node): node is FunctionNode =>
      node.type === 'function' && node.value.toLowerCase() === 'var',
  );
  const name = variable?.nodes[0]?.value;
  const percentage = first
    .filter((node) => node !== variable)
    .map((node) => valueParser.unit(node.value) || { number: '', unit: '' });
  const isTransparent =
    second.length === 1 && second[0]!.value.toLowerCase() === 'transparent';
  if (
    !name ||
    !channelVariables.has(name) ||
    variable!.nodes.length !== 1 ||
    !isTransparent ||
    percentage.length > 1 ||
    (percentage.length === 1 && percentage[0]?.unit !== '%')
  ) {
    return undefined;
  }
  const alpha = percentage[0] ? Number(percentage[0].number) / 100 : 0.5;
  return `rgba(var(${name}-rgb), ${Number(alpha.toFixed(4))})`;
};

/**
 * Serializes a color as the comma-separated `rgb()`/`rgba()` Lynx reads.
 */
const formatRgb = ({ r, g, b, alpha }: Rgb): string => {
  const channel = (value: number) => Math.round(clamp01(value) * 255);
  const channels = `${channel(r)}, ${channel(g)}, ${channel(b)}`;
  const a = Number(clamp01(alpha).toFixed(4));
  return a === 1 ? `rgb(${channels})` : `rgba(${channels}, ${a})`;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Evaluates a color: a hex or named color word, or a color function whose
 * arguments are all static. Returns `undefined` for anything else.
 */
const parseColor = (node: Node): Rgb | undefined => {
  if (node.type === 'word') {
    const word = node.value.toLowerCase();
    if (word === 'transparent') {
      return { r: 0, g: 0, b: 0, alpha: 0 };
    }
    // A word like `constructor` finds a function here, which isn't hex.
    const named = NAMED_COLORS[word];
    return parseHex(typeof named === 'string' ? `#${named}` : word);
  }
  if (node.type !== 'function') {
    return undefined;
  }
  const name = node.value.toLowerCase();
  if (!COLOR_FUNCTIONS.has(name)) {
    return undefined;
  }
  if (name === 'color-mix') {
    return parseColorMix(node.nodes);
  }
  const args = colorArguments(node.nodes);
  if (!args) {
    return undefined;
  }
  const { channels, alpha } = args;
  switch (name) {
    case 'rgb':
    case 'rgba':
      return withAlpha(
        rgbFromChannels(channels.map((c) => channel(c, 255))),
        alpha,
      );
    case 'hsl':
    case 'hsla':
      return withAlpha(
        hslToRgb(
          angle(channels[0]),
          percent(channels[1]),
          percent(channels[2]),
        ),
        alpha,
      );
    case 'hwb':
      return withAlpha(
        hwbToRgb(
          angle(channels[0]),
          percent(channels[1]),
          percent(channels[2]),
        ),
        alpha,
      );
    case 'lab':
      return withAlpha(
        labToRgb([
          channel(channels[0], 100),
          channel(channels[1], 125),
          channel(channels[2], 125),
        ]),
        alpha,
      );
    case 'lch':
      return withAlpha(
        labToRgb(
          polarToRectangular([
            channel(channels[0], 100),
            channel(channels[1], 150),
            angle(channels[2]),
          ]),
        ),
        alpha,
      );
    case 'oklab':
      return withAlpha(
        oklabToRgb([
          channel(channels[0], 1),
          channel(channels[1], 0.4),
          channel(channels[2], 0.4),
        ]),
        alpha,
      );
    default:
      // oklch, the last of COLOR_FUNCTIONS.
      return withAlpha(
        oklabToRgb(
          polarToRectangular([
            channel(channels[0], 1),
            channel(channels[1], 0.4),
            angle(channels[2]),
          ]),
        ),
        alpha,
      );
  }
};

const rgbFromChannels = ([r, g, b]: number[]): Rgb => ({
  r: r! / 255,
  g: g! / 255,
  b: b! / 255,
  alpha: 1,
});

const withAlpha = (color: Rgb, alpha: string | undefined): Rgb => ({
  ...color,
  alpha: alpha === undefined ? 1 : channel(alpha, 1),
});

const parseHex = (word: string): Rgb | undefined => {
  const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(word);
  if (!match) {
    return undefined;
  }
  let hex = match[1]!;
  if (hex.length <= 4) {
    hex = [...hex].map((digit) => digit + digit).join('');
  }
  const byte = (index: number) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16) / 255;
  return {
    r: byte(0),
    g: byte(1),
    b: byte(2),
    alpha: hex.length === 8 ? byte(3) : 1,
  };
};

/**
 * Splits a color function's arguments into its three channels and its alpha,
 * for both the space-separated syntax (`oklch(60% 0.2 145 / 50%)`) and the
 * legacy comma-separated one (`rgba(0, 0, 0, 0.5)`). Returns `undefined` when
 * an argument isn't a plain number, so `var()` and `calc()` stay dynamic.
 */
const colorArguments = (
  nodes: Node[],
): { channels: string[]; alpha: string | undefined } | undefined => {
  const words: string[] = [];
  let alpha: string | undefined;
  let afterSlash = false;
  for (const node of nodes) {
    if (node.type === 'space' || node.type === 'comment') {
      continue;
    }
    if (node.type === 'div') {
      afterSlash ||= node.value === '/';
      continue;
    }
    if (node.type !== 'word') {
      return undefined;
    }
    if (afterSlash) {
      alpha = node.value;
    } else {
      words.push(node.value);
    }
  }
  // Legacy syntax: the fourth comma-separated value is the alpha.
  if (alpha === undefined && words.length === 4) {
    alpha = words.pop();
  }
  if (
    words.length !== 3 ||
    ![...words, ...(alpha === undefined ? [] : [alpha])].every(isNumeric)
  ) {
    return undefined;
  }
  return { channels: words, alpha };
};

const isNumeric = (word: string) =>
  word.toLowerCase() === 'none' || valueParser.unit(word) !== false;

/**
 * Reads a channel: a number as it is, or a percentage of `full` (`100%` in
 * `oklch()` lightness is 1, in `lab()` lightness 100). `none` is 0.
 */
const channel = (word: string | undefined, full: number): number => {
  const { number, unit } = valueParser.unit(word!) || { number: '0', unit: '' };
  return unit === '%' ? (Number(number) / 100) * full : Number(number);
};

/**
 * Reads a percentage (for `hsl()` and `hwb()`) as a fraction.
 */
const percent = (word: string | undefined): number => channel(word, 100) / 100;

/**
 * Reads a hue in degrees, from a number or any CSS angle unit.
 */
const angle = (word: string | undefined): number => {
  const { number, unit } = valueParser.unit(word!) || { number: '0', unit: '' };
  const value = Number(number);
  switch (unit.toLowerCase()) {
    case 'rad':
      return (value * 180) / Math.PI;
    case 'grad':
      return value * 0.9;
    case 'turn':
      return value * 360;
    default:
      return value;
  }
};

const hslToRgb = (hue: number, saturation: number, lightness: number): Rgb => {
  const h = ((hue % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4), alpha: 1 };
};

const hwbToRgb = (hue: number, whiteness: number, blackness: number): Rgb => {
  if (whiteness + blackness >= 1) {
    const gray = whiteness / (whiteness + blackness);
    return { r: gray, g: gray, b: gray, alpha: 1 };
  }
  const { r, g, b } = hslToRgb(hue, 1, 0.5);
  const scale = (value: number) =>
    value * (1 - whiteness - blackness) + whiteness;
  return { r: scale(r), g: scale(g), b: scale(b), alpha: 1 };
};

const polarToRectangular = ([lightness, chroma, hue]: Triple): Triple => {
  const radians = (hue * Math.PI) / 180;
  return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
};

const rectangularToPolar = ([lightness, a, b]: Triple): Triple => {
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return [lightness, Math.hypot(a, b), (hue + 360) % 360];
};

/**
 * sRGB transfer function: linear light to gamma-encoded.
 */
const gammaEncode = (value: number) => {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return abs > 0.0031308
    ? sign * (1.055 * abs ** (1 / 2.4) - 0.055)
    : 12.92 * value;
};

/**
 * sRGB transfer function: gamma-encoded to linear light.
 */
const gammaDecode = (value: number) => {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return abs > 0.04045 ? sign * ((abs + 0.055) / 1.055) ** 2.4 : value / 12.92;
};

/**
 * The matrices below are CSS Color 4's (https://drafts.csswg.org/css-color-4/#color-conversion-code).
 */

const oklabToLinearRgb = ([l, a, b]: Triple): Triple => {
  const lms = [
    (l + 0.3963377773761749 * a + 0.2158037573099136 * b) ** 3,
    (l - 0.1055613458156586 * a - 0.0638541728258133 * b) ** 3,
    (l - 0.0894841775298119 * a - 1.2914855480194092 * b) ** 3,
  ] as const;
  return [
    4.0767416360759583 * lms[0] -
      3.3077115392580629 * lms[1] +
      0.2309699031821043 * lms[2],
    -1.2684379732850315 * lms[0] +
      2.6097573492876882 * lms[1] -
      0.341319376002657 * lms[2],
    -0.0041960761386756 * lms[0] -
      0.7034186179359363 * lms[1] +
      1.7076146940746117 * lms[2],
  ];
};

const linearRgbToOklab = ([r, g, b]: Triple): Triple => {
  const lms = [
    Math.cbrt(
      0.4122214694707629 * r + 0.5363325372617349 * g + 0.0514459932675022 * b,
    ),
    Math.cbrt(
      0.2119034958178251 * r + 0.6806995506452344 * g + 0.1073969535369406 * b,
    ),
    Math.cbrt(
      0.0883024591900564 * r + 0.2817188391361215 * g + 0.6299787016738223 * b,
    ),
  ] as const;
  return [
    0.2104542553 * lms[0] + 0.793617785 * lms[1] - 0.0040720468 * lms[2],
    1.9779984951 * lms[0] - 2.428592205 * lms[1] + 0.4505937099 * lms[2],
    0.0259040371 * lms[0] + 0.7827717662 * lms[1] - 0.808675766 * lms[2],
  ];
};

const encodeRgb = ([r, g, b]: Triple): Rgb => ({
  r: gammaEncode(r),
  g: gammaEncode(g),
  b: gammaEncode(b),
  alpha: 1,
});

const rgbToOklab = ({ r, g, b }: Rgb): Triple =>
  linearRgbToOklab([gammaDecode(r), gammaDecode(g), gammaDecode(b)]);

const isInGamut = ({ r, g, b }: Rgb) =>
  [r, g, b].every((value) => value >= -1e-6 && value <= 1 + 1e-6);

const clip = ({ r, g, b, alpha }: Rgb): Rgb => ({
  r: clamp01(r),
  g: clamp01(g),
  b: clamp01(b),
  alpha,
});

/**
 * Converts OKLab to sRGB, mapping a color outside sRGB into it by reducing
 * its chroma, as CSS Color 4's gamut mapping algorithm does.
 */
const oklabToRgb = (oklab: Triple): Rgb => {
  const color = encodeRgb(oklabToLinearRgb(oklab));
  if (isInGamut(color)) {
    return color;
  }
  const [lightness, chroma, hue] = rectangularToPolar(oklab);
  if (lightness >= 1) {
    return { r: 1, g: 1, b: 1, alpha: 1 };
  }
  if (lightness <= 0) {
    return { r: 0, g: 0, b: 0, alpha: 1 };
  }
  const JND = 0.02;
  const EPSILON = 0.0001;
  const atChroma = (c: number) =>
    encodeRgb(oklabToLinearRgb(polarToRectangular([lightness, c, hue])));
  const deltaE = (a: Triple, b: Triple) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let clipped = clip(color);
  if (deltaE(rgbToOklab(clipped), oklab) < JND) {
    return clipped;
  }
  let min = 0;
  let max = chroma;
  let minInGamut = true;
  while (max - min > EPSILON) {
    const c = (min + max) / 2;
    const current = atChroma(c);
    if (minInGamut && isInGamut(current)) {
      min = c;
      continue;
    }
    clipped = clip(current);
    const e = deltaE(
      rgbToOklab(clipped),
      polarToRectangular([lightness, c, hue]),
    );
    if (e < JND) {
      if (JND - e < EPSILON) {
        break;
      }
      minInGamut = false;
      min = c;
    } else {
      max = c;
    }
  }
  return clipped;
};

/**
 * CIE Lab (D50) to sRGB, through XYZ and the Bradford D50 to D65 adaptation.
 */
const labToRgb = ([l, a, b]: Triple): Rgb => {
  const k = 24389 / 27;
  const e = 216 / 24389;
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const xyz = [
    ((fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k) * 0.3457) / 0.3585,
    l > k * e ? fy ** 3 : l / k,
    ((fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k) * (1 - 0.3457 - 0.3585)) /
      0.3585,
  ] as const;
  const d65 = [
    0.955473421488075 * xyz[0] -
      0.02309845494876471 * xyz[1] +
      0.06325924320057072 * xyz[2],
    -0.0283697093338637 * xyz[0] +
      1.0099953980813041 * xyz[1] +
      0.021041441191917323 * xyz[2],
    0.012314014864481998 * xyz[0] -
      0.020507649298898964 * xyz[1] +
      1.330365926242124 * xyz[2],
  ] as const;
  const linear: Triple = [
    3.2409699419045226 * d65[0] -
      1.537383177570094 * d65[1] -
      0.4986107602930034 * d65[2],
    -0.9692436362808796 * d65[0] +
      1.8759675015077202 * d65[1] +
      0.04155505740717559 * d65[2],
    0.05563007969699366 * d65[0] -
      0.20397695888897652 * d65[1] +
      1.0569715142428786 * d65[2],
  ];
  const color = encodeRgb(linear);
  return isInGamut(color) ? color : oklabToRgb(linearRgbToOklab(linear));
};

/** The color spaces `color-mix()` can interpolate in here. */
type MixSpace = 'srgb' | 'srgb-linear' | 'oklab' | 'oklch';

/**
 * Evaluates `color-mix(in <space>, <color> [<p>], <color> [<p>])` with two
 * static colors, as CSS Color 5 defines it: percentages normalized to 100%,
 * channels premultiplied by alpha, and a hue taking the shorter arc. Tailwind
 * writes it for every opacity modifier, mixing with `transparent`.
 */
const parseColorMix = (nodes: Node[]): Rgb | undefined => {
  const parts = splitByComma(nodes);
  if (parts.length !== 3) {
    return undefined;
  }
  const space = mixSpace(parts[0]!);
  const first = mixColor(parts[1]!);
  const second = mixColor(parts[2]!);
  if (!space || !first || !second) {
    return undefined;
  }
  let p1 = first.percentage;
  let p2 = second.percentage;
  if (p1 === undefined && p2 === undefined) {
    p1 = p2 = 50;
  } else if (p1 === undefined) {
    p1 = 100 - p2!;
  } else if (p2 === undefined) {
    p2 = 100 - p1;
  }
  const sum = p1 + p2!;
  if (sum <= 0) {
    return undefined;
  }
  const mixed = interpolate(
    space,
    first.color,
    second.color,
    p2! / sum, // The weight of the second color.
  );
  return { ...mixed, alpha: (mixed.alpha * Math.min(sum, 100)) / 100 };
};

const splitByComma = (nodes: Node[]): Node[][] => {
  const parts: Node[][] = [[]];
  for (const node of nodes) {
    if (node.type === 'div' && node.value === ',') {
      parts.push([]);
    } else if (node.type !== 'space' && node.type !== 'comment') {
      parts[parts.length - 1]!.push(node);
    }
  }
  return parts;
};

const MIX_SPACES = new Set<string>(['srgb', 'srgb-linear', 'oklab', 'oklch']);

/**
 * Reads `in <space>` (an optional `shorter hue` is the default anyway).
 */
const mixSpace = (nodes: Node[]): MixSpace | undefined => {
  const words = nodes.map((node) => node.value.toLowerCase());
  const [keyword, space, ...hue] = words;
  const defaultHue =
    hue.length === 0 || (hue[0] === 'shorter' && hue[1] === 'hue');
  return keyword === 'in' && MIX_SPACES.has(space!) && defaultHue
    ? (space as MixSpace)
    : undefined;
};

/**
 * Reads one `<color> [<percentage>]` argument, in either order.
 */
const mixColor = (
  nodes: Node[],
): { color: Rgb; percentage: number | undefined } | undefined => {
  let color: Rgb | undefined;
  let percentage: number | undefined;
  for (const node of nodes) {
    const unit = node.type === 'word' && valueParser.unit(node.value);
    if (unit && unit.unit === '%' && percentage === undefined) {
      percentage = Number(unit.number);
    } else if (!color) {
      color = parseColor(node);
      if (!color) {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  return color && { color, percentage };
};

const interpolate = (
  space: MixSpace,
  from: Rgb,
  to: Rgb,
  weight: number,
): Rgb => {
  const alpha = from.alpha * (1 - weight) + to.alpha * weight;
  if (alpha === 0) {
    return { r: 0, g: 0, b: 0, alpha: 0 };
  }
  const blend = (a: number, b: number) =>
    (a * from.alpha * (1 - weight) + b * to.alpha * weight) / alpha;
  switch (space) {
    case 'srgb':
      return {
        r: blend(from.r, to.r),
        g: blend(from.g, to.g),
        b: blend(from.b, to.b),
        alpha,
      };
    case 'srgb-linear':
      return {
        ...encodeRgb([
          blend(gammaDecode(from.r), gammaDecode(to.r)),
          blend(gammaDecode(from.g), gammaDecode(to.g)),
          blend(gammaDecode(from.b), gammaDecode(to.b)),
        ]),
        alpha,
      };
    case 'oklab': {
      const a = rgbToOklab(from);
      const b = rgbToOklab(to);
      return {
        ...oklabToRgb([
          blend(a[0], b[0]),
          blend(a[1], b[1]),
          blend(a[2], b[2]),
        ]),
        alpha,
      };
    }
    default: {
      // oklch, the last of MIX_SPACES.
      const a = rectangularToPolar(rgbToOklab(from));
      const b = rectangularToPolar(rgbToOklab(to));
      /**
       * A color with no chroma (black, white, gray or `transparent`) has no
       * hue, so the mix takes the other color's: mixing red with
       * `transparent` stays red rather than drifting toward hue 0.
       */
      const powerless = (color: Triple, source: Rgb) =>
        color[1] < 1e-4 || source.alpha === 0;
      const hueA = powerless(a, from) ? b[2] : a[2];
      const hueB = powerless(b, to) ? a[2] : b[2];
      let delta = hueB - hueA;
      if (delta > 180) {
        delta -= 360;
      } else if (delta < -180) {
        delta += 360;
      }
      // Hue is not premultiplied (CSS Color 4, §12.3).
      const hue = hueA + delta * weight;
      return {
        ...oklabToRgb(
          polarToRectangular([blend(a[0], b[0]), blend(a[1], b[1]), hue]),
        ),
        alpha,
      };
    }
  }
};
