// cspell:words currentcolor rrggbb

/**
 * CSS colors as the 2D context takes them (`fillStyle`, `shadowColor`, a
 * gradient's stops): parsed here, so the shells get four numbers and the
 * getters give back the browser's serialization. A string that isn't a color
 * leaves the property as it was, as in a browser.
 */

/** Red, green and blue from 0 to 255, and alpha from 0 to 1. */
export type RGBA = readonly [number, number, number, number];

// CSS's named colors, as name:hex pairs, unpacked on first use.
// The color names, run together, aren't words cspell knows.
// cspell:disable
const NAMED =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';
// cspell:enable

let named: Map<string, string> | undefined;

const namedColor = (name: string): string | undefined => {
  if (!named) {
    named = new Map();
    for (const pair of NAMED.split(',')) {
      const [key, hex] = pair.split(':');
      named.set(key, hex);
    }
  }
  return named.get(name);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const fromHex = (hex: string): RGBA | null => {
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  const digit = (i: number) => parseInt(hex[i] + hex[i], 16);
  const pair = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  switch (hex.length) {
    case 3:
      return [digit(0), digit(1), digit(2), 1];
    case 4:
      return [digit(0), digit(1), digit(2), digit(3) / 255];
    case 6:
      return [pair(0), pair(2), pair(4), 1];
    case 8:
      return [pair(0), pair(2), pair(4), pair(6) / 255];
    default:
      return null;
  }
};

/**
 * An angle in degrees.
 */
const hueOf = (token: string): number => {
  const match = /^(-?[\d.]+(?:e[-+]?\d+)?)(deg|rad|grad|turn)?$/.exec(token);
  if (!match) return token === 'none' ? 0 : NaN;
  const value = Number(match[1]);
  switch (match[2]) {
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

/**
 * A function's arguments, in its legacy comma form (`rgb(1, 2, 3)`) or its
 * modern one (`rgb(1 2 3 / 50%)`). The last item is the alpha, if any.
 */
const argumentsOf = (
  body: string,
): { parts: string[]; legacy: boolean } | null => {
  const trimmed = body.trim();
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((part) => part.trim());
    return parts.length === 3 || parts.length === 4
      ? { parts, legacy: true }
      : null;
  }
  const [main, alpha, extra] = trimmed.split('/').map((part) => part.trim());
  if (extra !== undefined) return null;
  const parts = main.split(/\s+/);
  if (parts.length !== 3) return null;
  if (alpha !== undefined) {
    if (alpha === '') return null;
    parts.push(alpha);
  }
  return { parts, legacy: false };
};

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/;
const isNumber = (token: string): boolean => NUMBER.test(token);
const isPercentage = (token: string): boolean =>
  token.endsWith('%') && isNumber(token.slice(0, -1));

/**
 * A channel: a number, a percentage of `percentOf`, or, in the modern
 * syntax, `none` (0). NaN for anything else.
 */
const channelOf = (
  token: string,
  percentOf: number,
  legacy: boolean,
): number => {
  if (token === 'none') return legacy ? NaN : 0;
  if (isPercentage(token)) {
    return (Number(token.slice(0, -1)) / 100) * percentOf;
  }
  return isNumber(token) ? Number(token) : NaN;
};

/**
 * Saturation, lightness, whiteness or blackness, from 0 to 1.
 */
const fractionOf = (token: string, legacy: boolean): number =>
  isNumber(token)
    ? legacy
      ? NaN
      : Number(token) / 100
    : channelOf(token, 1, legacy);

const alphaOf = (token: string | undefined, legacy: boolean): number =>
  token === undefined ? 1 : clamp(channelOf(token, 1, legacy), 0, 1);

const hslToRgb = (hue: number, saturation: number, lightness: number) => {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = clamp(saturation, 0, 1);
  const l = clamp(lightness, 0, 1);
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0) * 255, channel(8) * 255, channel(4) * 255];
};

/**
 * rgb(), hsl() and hwb(), as CSS Color 4 reads them: the legacy comma syntax
 * takes rgb()'s channels all as numbers or all as percentages, and hsl()'s
 * saturation and lightness as percentages, with no `none`; hwb() has only
 * the modern syntax.
 */
const fromFunction = (name: string, body: string): RGBA | null => {
  const parsed = argumentsOf(body);
  if (!parsed) return null;
  const { parts: args, legacy } = parsed;
  let rgb: number[];
  switch (name) {
    case 'rgb':
    case 'rgba': {
      const channels = args.slice(0, 3);
      if (
        legacy &&
        !channels.every(isNumber) &&
        !channels.every(isPercentage)
      ) {
        return null;
      }
      rgb = channels.map((token) => channelOf(token, 255, legacy));
      break;
    }
    case 'hsl':
    case 'hsla':
      // The legacy syntax has no `none`, the hue's included.
      if (legacy && args[0] === 'none') return null;
      rgb = hslToRgb(
        hueOf(args[0]),
        fractionOf(args[1], legacy),
        fractionOf(args[2], legacy),
      );
      break;
    case 'hwb': {
      if (legacy) return null;
      const hue = hueOf(args[0]);
      if (Number.isNaN(hue)) return null;
      const white = Math.max(0, fractionOf(args[1], false));
      const black = Math.max(0, fractionOf(args[2], false));
      if (white + black >= 1) {
        // Too much white and black together is a gray, in their proportion.
        const gray = (white / (white + black)) * 255;
        rgb = [gray, gray, gray];
      } else {
        rgb = hslToRgb(hue, 1, 0.5).map(
          (value) => (value / 255) * (1 - white - black) * 255 + white * 255,
        );
      }
      break;
    }
    default:
      return null;
  }
  const alpha = alphaOf(args[3], legacy);
  if (rgb.some((value) => Number.isNaN(value)) || Number.isNaN(alpha)) {
    return null;
  }
  const [r, g, b] = rgb.map((value) => Math.round(clamp(value, 0, 255)));
  return [r, g, b, alpha];
};

/**
 * A CSS color as RGBA, or null when the string isn't one. `currentcolor`
 * is black: a canvas's own `color` is black unless the page sets it, and
 * Lynx gives the main thread no computed styles.
 */
export const parseColor = (value: unknown): RGBA | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (text.startsWith('#')) return fromHex(text.slice(1));
  if (text === 'transparent') return [0, 0, 0, 0];
  if (text === 'currentcolor') return [0, 0, 0, 1];
  const hex = namedColor(text);
  if (hex) return fromHex(hex);
  const match = /^([a-z]+)\((.*)\)$/s.exec(text);
  return match ? fromFunction(match[1], match[2]) : null;
};

const hex2 = (value: number): string => value.toString(16).padStart(2, '0');

/**
 * A color as a browser's 2D context serializes it: `#rrggbb` when it's
 * opaque, `rgba(r, g, b, a)` when it isn't.
 */
export const serializeColor = ([r, g, b, a]: RGBA): string => {
  if (a >= 1) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  // Browsers keep the alpha to 8 bits, and write the shortest decimal that
  // comes back to the same 8 bits: 0.3, not 0.30196.
  const byte = Math.round(a * 255);
  let alpha = String(byte / 255);
  for (let digits = 1; digits <= 6; digits++) {
    const short = Number((byte / 255).toFixed(digits));
    if (Math.round(short * 255) === byte) {
      alpha = String(short);
      break;
    }
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
