import { LynxDOMException } from './dom-exception';

/**
 * Base64 for the bytes of request and response bodies, which cross between
 * Lynx's threads as JSON. Hand-written because neither thread has `btoa` or
 * `atob`, and the main thread has no other way to turn bytes into a string.
 * Both threads get `atob` and `btoa` from here too (lynxAtob() below).
 */

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Builds the string in slices: one `String.fromCharCode` call per slice keeps
 * the work linear, where adding a character at a time can copy the whole
 * string on every step in an engine without rope strings.
 */
const SLICE = 8192;

/**
 * Encodes bytes as standard base64, with padding.
 *
 * @param bytes - The bytes to encode.
 * @returns The base64 text.
 */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  const codes: number[] = [];
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] as number;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    codes.push(
      ALPHABET.charCodeAt(a >> 2),
      ALPHABET.charCodeAt(((a & 0x3) << 4) | ((b ?? 0) >> 4)),
      b === undefined
        ? 0x3d
        : ALPHABET.charCodeAt(((b & 0xf) << 2) | ((c ?? 0) >> 6)),
      c === undefined ? 0x3d : ALPHABET.charCodeAt(c & 0x3f),
    );
    if (codes.length >= SLICE) {
      output += String.fromCharCode(...codes);
      codes.length = 0;
    }
  }
  return output + String.fromCharCode(...codes);
};

/**
 * Each character code's value in the alphabet, or 0xff for a character
 * outside it. A table lookup by `charCodeAt` keeps decoding a photo, several
 * megabytes of base64, fast on PrimJS, which has no JIT: a Map lookup per
 * character and an array of every value took several times as long.
 */
const VALUES = new Uint8Array(256).fill(0xff);
for (let index = 0; index < ALPHABET.length; index++) {
  VALUES[ALPHABET.charCodeAt(index)] = index;
}

/**
 * Decodes standard base64. Padding is optional, and characters outside the
 * alphabet, such as line breaks, are skipped.
 *
 * @param base64 - The base64 text.
 * @returns The bytes.
 */
export const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
  // At most this many: every character in the alphabet.
  const bytes = new Uint8Array(Math.floor((base64.length * 3) / 4));
  let byteIndex = 0;
  // The last characters' values, 6 bits each, until there are 4 (3 bytes).
  let bits = 0;
  let count = 0;
  for (let index = 0; index < base64.length; index++) {
    const code = base64.charCodeAt(index);
    const value = code < 256 ? (VALUES[code] as number) : 0xff;
    if (value === 0xff) continue;
    bits = (bits << 6) | value;
    if (++count === 4) {
      bytes[byteIndex++] = bits >> 16;
      bytes[byteIndex++] = (bits >> 8) & 0xff;
      bytes[byteIndex++] = bits & 0xff;
      bits = 0;
      count = 0;
    }
  }
  // Text without padding ends with 2 or 3 characters: 1 or 2 more bytes.
  if (count === 2) {
    bytes[byteIndex++] = bits >> 4;
  } else if (count === 3) {
    bytes[byteIndex++] = bits >> 10;
    bytes[byteIndex++] = (bits >> 2) & 0xff;
  }
  // A body crosses threads as `bytes.buffer`, so it must hold only these.
  return byteIndex === bytes.length ? bytes : bytes.slice(0, byteIndex);
};

const invalidCharacter = (method: string, message: string) =>
  new LynxDOMException(
    `Failed to execute '${method}' on 'Window': ${message}`,
    'InvalidCharacterError',
  );

/**
 * `btoa` for Lynx's threads, which have none: encodes a binary string, one
 * byte per character, as base64. Firebase encodes the tokens it sends back
 * to Firestore with it (issue #206).
 *
 * @param data - The binary string.
 * @returns The base64 text.
 */
export const lynxBtoa = (data: unknown): string => {
  const text = String(data);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code > 0xff) {
      throw invalidCharacter(
        'btoa',
        'The string to be encoded contains characters outside of the Latin1 range.',
      );
    }
    bytes[index] = code;
  }
  return bytesToBase64(bytes);
};

/**
 * `atob` for Lynx's threads, which have none. Firebase decodes the tokens
 * Firestore sends with it, so a query threw a ReferenceError once its first
 * response arrived (issues #205 and #206).
 *
 * Strict where base64ToBytes() is lenient, as the HTML Standard's `atob`
 * is: it skips only ASCII whitespace, and throws on other characters
 * outside the alphabet and on a length no base64 text can have.
 *
 * @param data - The base64 text.
 * @returns The binary string, one byte per character.
 */
export const lynxAtob = (data: unknown): string => {
  let text = String(data).replace(/[\t\n\f\r ]/g, '');
  if (text.length % 4 === 0) text = text.replace(/==?$/, '');
  if (text.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(text)) {
    throw invalidCharacter(
      'atob',
      'The string to be decoded is not correctly encoded.',
    );
  }
  const bytes = base64ToBytes(text);
  let output = '';
  for (let index = 0; index < bytes.length; index += SLICE) {
    output += String.fromCharCode(...bytes.subarray(index, index + SLICE));
  }
  return output;
};
