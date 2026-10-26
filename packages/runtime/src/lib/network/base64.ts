/**
 * Base64 for the bytes of request and response bodies, which cross between
 * Lynx's threads as JSON. Hand-written because neither thread has `btoa` or
 * `atob`, and the main thread has no other way to turn bytes into a string.
 */

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const VALUES = new Map(Array.from(ALPHABET, (char, index) => [char, index]));

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
 * Decodes standard base64. Padding is optional, and characters outside the
 * alphabet, such as line breaks, are skipped.
 *
 * @param base64 - The base64 text.
 * @returns The bytes.
 */
export const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
  const values: number[] = [];
  for (const char of base64) {
    const value = VALUES.get(char);
    if (value !== undefined) values.push(value);
  }
  const bytes = new Uint8Array(Math.floor((values.length * 3) / 4));
  let byteIndex = 0;
  for (let index = 0; index < values.length; index += 4) {
    const a = values[index] as number;
    const b = values[index + 1] ?? 0;
    const c = values[index + 2];
    const d = values[index + 3];
    bytes[byteIndex++] = (a << 2) | (b >> 4);
    if (c !== undefined) bytes[byteIndex++] = ((b & 0xf) << 4) | (c >> 2);
    if (d !== undefined) bytes[byteIndex++] = ((c! & 0x3) << 6) | d;
  }
  return bytes;
};
