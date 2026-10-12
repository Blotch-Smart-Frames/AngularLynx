/**
 * UTF-8 and percent-encoding helpers for the `URL` polyfill, following the
 * WHATWG URL Standard (https://url.spec.whatwg.org/#percent-encoded-bytes).
 *
 * They work on UTF-8 bytes rather than on `encodeURIComponent`/
 * `decodeURIComponent`, because those differ from the standard: they throw on
 * malformed input (lone surrogates, invalid `%` sequences) where URLs replace
 * the bad bytes with U+FFFD, and they encode a different set of characters.
 */

const REPLACEMENT_CHARACTER = 0xfffd;

/**
 * Encodes a string as UTF-8 bytes. Lone surrogates become U+FFFD.
 *
 * Hand-written rather than using `TextEncoder`: that's a Web API, not part of
 * JavaScript, so neither of Lynx's threads can be assumed to have it, and the
 * polyfill exists precisely for runtimes that lack Web APIs.
 */
export const utf8Encode = (input: string): number[] => {
  const bytes: number[] = [];
  for (const char of input) {
    let codePoint = char.codePointAt(0) as number;
    // A lone surrogate can't be encoded as UTF-8; USVString conversion
    // replaces it, as browsers do.
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      codePoint = REPLACEMENT_CHARACTER;
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
};

/**
 * Decodes UTF-8 bytes, replacing each invalid sequence with U+FFFD the way
 * the Encoding Standard's UTF-8 decoder does
 * (https://encoding.spec.whatwg.org/#utf-8-decoder).
 */
export const utf8Decode = (bytes: readonly number[]): string => {
  let output = '';
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index] as number;
    if (lead < 0x80) {
      output += String.fromCharCode(lead);
      index++;
      continue;
    }
    // The valid range of the first continuation byte narrows for some leads,
    // which rules out overlong encodings and surrogates.
    let lower = 0x80;
    let upper = 0xbf;
    let needed: number;
    let codePoint: number;
    if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1;
      codePoint = lead & 0x1f;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      if (lead === 0xe0) lower = 0xa0;
      if (lead === 0xed) upper = 0x9f;
      needed = 2;
      codePoint = lead & 0xf;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      if (lead === 0xf0) lower = 0x90;
      if (lead === 0xf4) upper = 0x8f;
      needed = 3;
      codePoint = lead & 0x7;
    } else {
      output += String.fromCharCode(REPLACEMENT_CHARACTER);
      index++;
      continue;
    }
    let seen = 0;
    while (seen < needed) {
      const next = bytes[index + 1 + seen];
      if (next === undefined || next < lower || next > upper) break;
      lower = 0x80;
      upper = 0xbf;
      codePoint = (codePoint << 6) | (next & 0x3f);
      seen++;
    }
    if (seen < needed) {
      // The byte that broke the sequence starts the next one, so only the
      // lead and the valid continuation bytes are consumed.
      output += String.fromCharCode(REPLACEMENT_CHARACTER);
      index += 1 + seen;
      continue;
    }
    output += String.fromCodePoint(codePoint);
    index += 1 + needed;
  }
  return output;
};

const toCodes = (chars: string): ReadonlySet<number> =>
  new Set(Array.from(chars, (char) => char.charCodeAt(0)));

/**
 * The standard's percent-encode sets. Each also includes the C0 controls and
 * everything above U+007E, which `percentEncode` always encodes.
 *
 * That shared part is checked by a range test in `percentEncode` instead of
 * being stored in every set, so the C0 control set itself is empty: it adds
 * nothing to the range test (opaque paths and opaque hosts use it).
 */
export const C0_CONTROL_SET: ReadonlySet<number> = new Set();
export const FRAGMENT_SET = toCodes(' "<>`');
export const QUERY_SET = toCodes(' "#<>');
export const SPECIAL_QUERY_SET = toCodes(' "#<>\'');
export const PATH_SET = toCodes(' "#<>?^`{}');
export const USERINFO_SET = toCodes(' "#<>?^`{}/:;=@[\\]|');

/**
 * The standard serializes escapes with uppercase hex and two digits (`%0A`,
 * `%2F`), and code comparing `href`s (such as the Router's same-URL check)
 * sees any other spelling as a different URL.
 */
const percentEncodeByte = (byte: number): string =>
  (byte < 0x10 ? '%0' : '%') + byte.toString(16).toUpperCase();

/**
 * Percent-encodes the code points of `input` that are C0 controls, non-ASCII,
 * or in `encodeSet`. `%` itself is never encoded, so existing escapes survive.
 */
export const percentEncode = (
  input: string,
  encodeSet: ReadonlySet<number>,
): string => {
  let output = '';
  for (const char of input) {
    const codePoint = char.codePointAt(0) as number;
    if (codePoint < 0x20 || codePoint > 0x7e || encodeSet.has(codePoint)) {
      for (const byte of utf8Encode(char)) output += percentEncodeByte(byte);
    } else {
      output += char;
    }
  }
  return output;
};

const isHexDigit = (byte: number | undefined): boolean =>
  byte !== undefined &&
  ((byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x46) ||
    (byte >= 0x61 && byte <= 0x66));

/**
 * Decodes `%XX` escapes as UTF-8. A `%` that doesn't start an escape is kept,
 * and invalid UTF-8 becomes U+FFFD, so it never throws.
 */
export const percentDecode = (input: string): string => {
  // Most names and values have no escapes, so skip the byte round trip.
  if (!input.includes('%')) return input;
  const bytes = utf8Encode(input);
  const decoded: number[] = [];
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index] as number;
    if (
      byte === 0x25 &&
      isHexDigit(bytes[index + 1]) &&
      isHexDigit(bytes[index + 2])
    ) {
      decoded.push(
        parseInt(
          String.fromCharCode(
            bytes[index + 1] as number,
            bytes[index + 2] as number,
          ),
          16,
        ),
      );
      index += 2;
    } else {
      decoded.push(byte);
    }
  }
  return utf8Decode(decoded);
};

/**
 * The `application/x-www-form-urlencoded` byte serializer used by
 * `URLSearchParams`: spaces become `+`, and everything except ASCII
 * alphanumerics and `*-._` is percent-encoded.
 */
export const formUrlEncode = (input: string): string => {
  let output = '';
  for (const byte of utf8Encode(input)) {
    if (byte === 0x20) {
      output += '+';
    } else if (
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      byte === 0x2a ||
      byte === 0x2d ||
      byte === 0x2e ||
      byte === 0x5f
    ) {
      output += String.fromCharCode(byte);
    } else {
      output += percentEncodeByte(byte);
    }
  }
  return output;
};
