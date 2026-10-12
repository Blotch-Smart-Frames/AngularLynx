import {
  C0_CONTROL_SET,
  percentDecode,
  percentEncode,
} from './percent-encoding';

/**
 * Host parsing for the `URL` polyfill, following the WHATWG URL Standard's
 * host parser (https://url.spec.whatwg.org/#host-parsing): domains, IPv4
 * (including the shorthand and hex/octal forms browsers accept), IPv6, and the
 * opaque hosts of non-special schemes.
 *
 * Domains are lowercased and non-ASCII labels Punycode-encoded. That covers
 * the internationalized-domain processing real hosts need, without the full
 * UTS #46 mapping tables, which would add far more to the bundle than they're
 * worth here.
 */

/**
 * Thrown for any input the standard says fails to parse.
 *
 * A `TypeError` with the browsers' message, because callers rely on the
 * failure looking like the real `URL`'s: Angular's Router catches it to treat
 * a URL as unsafe, and `URL.canParse()` and `URL.parse()` turn it into
 * `false` and `null`.
 */
export const invalidUrl = (): TypeError => new TypeError('Invalid URL');

// Opaque hosts (`foo://host`) only reject these delimiters; their control
// characters and `%` are percent-encoded instead. Domains of special URLs
// (`http://host`) also reject control characters and `%`, which by then have
// been percent-decoded, so a `%` left over is a malformed escape.
// oxlint-disable-next-line no-control-regex -- the URL Standard forbids NUL here
const FORBIDDEN_HOST = /[\u0000\t\n\r #/:<>?@[\\\]^|]/;
// oxlint-disable-next-line no-control-regex -- the URL Standard forbids C0 controls and DEL here
const FORBIDDEN_DOMAIN = /[\u0000-\u001f #%/:<>?@[\\\]^|\u007f]/;

// RFC 3492 parameters for Punycode.
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

const adaptBias = (
  delta: number,
  numPoints: number,
  firstTime: boolean,
): number => {
  let scaled = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  scaled += Math.floor(scaled / numPoints);
  let k = 0;
  while (scaled > ((BASE - T_MIN) * T_MAX) >> 1) {
    scaled = Math.floor(scaled / (BASE - T_MIN));
    k += BASE;
  }
  return Math.floor(k + ((BASE - T_MIN + 1) * scaled) / (scaled + SKEW));
};

/**
 * Maps a Punycode digit value (0-35) to `a`-`z` then `0`-`9`.
 */
const punycodeDigit = (digit: number): string =>
  String.fromCharCode(digit < 26 ? digit + 97 : digit + 22);

/**
 * Punycode-encodes one label (RFC 3492, section 6.3).
 *
 * Implemented here because nothing on Lynx provides it: Node's `punycode`
 * module doesn't exist outside Node, and the encoder is small enough that a
 * dependency isn't worth it.
 */
export const punycodeEncode = (label: string): string => {
  const codePoints = Array.from(label, (char) => char.codePointAt(0) as number);
  let output = codePoints
    .filter((codePoint) => codePoint < 0x80)
    .map((codePoint) => String.fromCharCode(codePoint))
    .join('');
  const basicLength = output.length;
  let handled = basicLength;
  if (basicLength > 0) output += '-';

  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < codePoints.length) {
    const next = Math.min(...codePoints.filter((codePoint) => codePoint >= n));
    delta += (next - n) * (handled + 1);
    n = next;
    for (const codePoint of codePoints) {
      if (codePoint < n) delta++;
      if (codePoint !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
        if (q < t) break;
        output += punycodeDigit(t + ((q - t) % (BASE - t)));
        q = Math.floor((q - t) / (BASE - t));
      }
      output += punycodeDigit(q);
      bias = adaptBias(delta, handled + 1, handled === basicLength);
      delta = 0;
      handled++;
    }
    delta++;
    n++;
  }
  return output;
};

/**
 * Converts a decoded domain to its ASCII form, so `http://München.de` and
 * `http://xn--mnchen-3ya.de` are the same host, as in browsers.
 *
 * `toLowerCase()` stands in for UTS #46's case mapping, which it matches for
 * the domains apps actually use.
 */
const domainToAscii = (domain: string): string =>
  domain
    .toLowerCase()
    // Domain name mapping turns the ideographic and full-width full stops
    // into `.`.
    .replace(/[。．｡]/g, '.')
    .split('.')
    .map((label) =>
      // oxlint-disable-next-line no-control-regex -- matches any non-ASCII character
      /[^\u0000-\u007f]/.test(label) ? `xn--${punycodeEncode(label)}` : label,
    )
    .join('.');

/**
 * Parses one IPv4 part: decimal, `0x` hex or leading-zero octal.
 */
const parseIpv4Number = (part: string): number | undefined => {
  if (part === '') return undefined;
  let digits = part;
  let radix = 10;
  if (/^0x/i.test(digits)) {
    digits = digits.slice(2);
    radix = 16;
  } else if (digits.length > 1 && digits.startsWith('0')) {
    digits = digits.slice(1);
    radix = 8;
  }
  if (digits === '') return 0;
  const valid =
    radix === 10 ? /^[0-9]+$/ : radix === 16 ? /^[0-9a-f]+$/i : /^[0-7]+$/;
  return valid.test(digits) ? parseInt(digits, radix) : undefined;
};

/**
 * Splits off the empty label a trailing `.` leaves behind.
 */
const ipv4Parts = (host: string): string[] => {
  const parts = host.split('.');
  if (parts[parts.length - 1] === '' && parts.length > 1) parts.pop();
  return parts;
};

/**
 * Whether the host must be parsed as IPv4: its last label is a number. A host
 * like `1.2.3.foo` stays a domain, but `foo.0x10` is an (invalid) address.
 */
const endsInANumber = (host: string): boolean => {
  const last = ipv4Parts(host).pop() as string;
  return /^[0-9]+$/.test(last) || parseIpv4Number(last) !== undefined;
};

/**
 * Parses and normalizes an IPv4 address, as browsers do, so the shorthand and
 * hex/octal spellings (`127.1`, `0x7f.0.0.1`) give the same host, and so the
 * same origin, as `127.0.0.1`.
 */
const parseIpv4 = (host: string): string => {
  const parts = ipv4Parts(host);
  if (parts.length > 4) throw invalidUrl();
  const numbers = parts.map((part) => {
    const value = parseIpv4Number(part);
    if (value === undefined) throw invalidUrl();
    return value;
  });
  const last = numbers.pop() as number;
  // Every part but the last is one byte; the last fills the remaining bytes.
  if (
    numbers.some((value) => value > 255) ||
    last >= 256 ** (4 - numbers.length)
  ) {
    throw invalidUrl();
  }
  let address = last;
  numbers.forEach((value, index) => {
    address += value * 256 ** (3 - index);
  });
  const bytes: number[] = [];
  for (let index = 0; index < 4; index++) {
    bytes.unshift(address % 256);
    address = Math.floor(address / 256);
  }
  return bytes.join('.');
};

/**
 * The IPv6 parser, transcribed from the standard's algorithm.
 */
const parseIpv6 = (input: string): number[] => {
  const address = [0, 0, 0, 0, 0, 0, 0, 0];
  let pieceIndex = 0;
  let compress: number | null = null;
  let pointer = 0;
  const at = (index: number): string | undefined => input[index];
  const isHex = (char: string | undefined): char is string =>
    char !== undefined && /[0-9a-f]/i.test(char);
  const isDigit = (char: string | undefined): char is string =>
    char !== undefined && /[0-9]/.test(char);

  if (at(pointer) === ':') {
    if (at(pointer + 1) !== ':') throw invalidUrl();
    pointer += 2;
    pieceIndex++;
    compress = pieceIndex;
  }
  while (at(pointer) !== undefined) {
    if (pieceIndex === 8) throw invalidUrl();
    if (at(pointer) === ':') {
      if (compress !== null) throw invalidUrl();
      pointer++;
      pieceIndex++;
      compress = pieceIndex;
      continue;
    }
    let value = 0;
    let length = 0;
    while (length < 4 && isHex(at(pointer))) {
      value = value * 0x10 + parseInt(at(pointer) as string, 16);
      pointer++;
      length++;
    }
    if (at(pointer) === '.') {
      // An embedded IPv4 address fills the last two pieces.
      if (length === 0 || pieceIndex > 6) throw invalidUrl();
      pointer -= length;
      let numbersSeen = 0;
      while (at(pointer) !== undefined) {
        if (numbersSeen > 0) {
          if (at(pointer) !== '.' || numbersSeen >= 4) throw invalidUrl();
          pointer++;
        }
        if (!isDigit(at(pointer))) throw invalidUrl();
        let ipv4Piece: number | null = null;
        while (isDigit(at(pointer))) {
          const digit = parseInt(at(pointer) as string, 10);
          if (ipv4Piece === 0) throw invalidUrl();
          ipv4Piece = ipv4Piece === null ? digit : ipv4Piece * 10 + digit;
          if (ipv4Piece > 255) throw invalidUrl();
          pointer++;
        }
        address[pieceIndex] =
          (address[pieceIndex] as number) * 0x100 + (ipv4Piece as number);
        numbersSeen++;
        if (numbersSeen === 2 || numbersSeen === 4) pieceIndex++;
      }
      if (numbersSeen !== 4) throw invalidUrl();
      break;
    }
    if (at(pointer) === ':') {
      pointer++;
      if (at(pointer) === undefined) throw invalidUrl();
    } else if (at(pointer) !== undefined) {
      throw invalidUrl();
    }
    address[pieceIndex] = value;
    pieceIndex++;
  }
  if (compress !== null) {
    // Move the pieces after `::` to the end of the address.
    let swaps = pieceIndex - compress;
    pieceIndex = 7;
    while (pieceIndex !== 0 && swaps > 0) {
      const swapIndex = compress + swaps - 1;
      const piece = address[pieceIndex] as number;
      address[pieceIndex] = address[swapIndex] as number;
      address[swapIndex] = piece;
      pieceIndex--;
      swaps--;
    }
  } else if (pieceIndex !== 8) {
    throw invalidUrl();
  }
  return address;
};

/**
 * Serializes an IPv6 address, compressing its longest run of zero pieces.
 */
const serializeIpv6 = (address: readonly number[]): string => {
  let compress: number | null = null;
  let longest = 1;
  for (let index = 0; index < 8; ) {
    let end = index;
    while (end < 8 && address[end] === 0) end++;
    if (end - index > longest) {
      longest = end - index;
      compress = index;
    }
    index = end === index ? index + 1 : end;
  }
  let output = '';
  for (let index = 0; index < 8; index++) {
    if (index === compress) {
      output += index === 0 ? '::' : ':';
      index += longest - 1;
      continue;
    }
    output += (address[index] as number).toString(16);
    if (index !== 7) output += ':';
  }
  return output;
};

/**
 * Parses a host. `isOpaque` is true for non-special schemes, whose hosts are
 * kept as written (only percent-encoded), as browsers do for `foo://Host`.
 *
 * A special URL's domain is percent-decoded before it's checked, because the
 * standard compares hosts by what they spell, not how they're escaped: a
 * percent-escaped letter names the same host as the letter itself.
 */
export const parseHost = (input: string, isOpaque: boolean): string => {
  if (input.startsWith('[')) {
    if (!input.endsWith(']')) throw invalidUrl();
    return `[${serializeIpv6(parseIpv6(input.slice(1, -1)))}]`;
  }
  if (isOpaque) {
    if (FORBIDDEN_HOST.test(input)) throw invalidUrl();
    return percentEncode(input, C0_CONTROL_SET);
  }
  const asciiDomain = domainToAscii(percentDecode(input));
  if (asciiDomain === '' || FORBIDDEN_DOMAIN.test(asciiDomain)) {
    throw invalidUrl();
  }
  return endsInANumber(asciiDomain) ? parseIpv4(asciiDomain) : asciiDomain;
};
