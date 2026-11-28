/**
 * `TextEncoder` and `TextDecoder` for Lynx's main thread, which has neither
 * (PrimJS implements only the JavaScript language). Angular's `FetchBackend`
 * decodes every `json` and `text` response with `new TextDecoder()`, so
 * `HttpClient` can't read a response without one. UTF-8 only: the Encoding
 * Standard's other encodings aren't needed for that, and an unknown label
 * throws a RangeError, as browsers do, which `FetchBackend` catches and falls
 * back to UTF-8.
 *
 * Lynx's background thread has `TextCodecHelper` instead (see the Lynx
 * networking guide), which the main thread lacks too.
 */

const UTF8_LABELS = new Set([
  'unicode-1-1-utf-8',
  'unicode11utf8',
  'unicode20utf8',
  'utf-8',
  'utf8',
  'x-unicode20utf8',
]);

const REPLACEMENT_CHARACTER = 0xfffd;
const BYTE_ORDER_MARK = 0xfeff;

/** See SLICE in base64.ts. */
const SLICE = 8192;

/**
 * A run of characters that aren't ASCII. Global, so a search can start from
 * `lastIndex`.
 */
const NON_ASCII_CHARACTERS = /[\u0080-\uffff]+/g;

/**
 * A byte over 0x7f, in a string of one character per byte. Global, so a
 * search can start from `lastIndex`.
 */
const NON_ASCII_BYTE = /[\x80-\xff]/g;

type BufferSource = ArrayBuffer | ArrayBufferView;

const toBytes = (input: BufferSource | undefined): Uint8Array => {
  if (input === undefined) return new Uint8Array(0);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError(
    "Failed to execute 'decode' on 'TextDecoder': The provided value is not of type '(ArrayBuffer or ArrayBufferView)'.",
  );
};

/**
 * The length of the UTF-8 sequence a lead byte starts, or 1 if it's invalid.
 */
const sequenceLength = (lead: number): number => {
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 1;
};

/**
 * How many of `bytes` can be decoded now: all but a multi-byte sequence cut
 * off at the end, which a streaming decode keeps for the next call.
 */
const completeLength = (bytes: ArrayLike<number>): number => {
  for (let back = 1; back <= 3 && back <= bytes.length; back++) {
    const byte = bytes[bytes.length - back] as number;
    if ((byte & 0xc0) !== 0x80) {
      return sequenceLength(byte) > back ? bytes.length - back : bytes.length;
    }
  }
  return bytes.length;
};

/**
 * Encodes `source` as UTF-8 into `destination`, stopping before a character
 * that doesn't fit, as `TextEncoder.encodeInto()` does. A lone surrogate
 * can't be encoded, so it becomes U+FFFD, as in browsers.
 *
 * A native regular expression finds the characters that aren't ASCII, and
 * the ASCII between them is copied by a loop that does nothing else. PrimJS
 * has no JIT, so the per-character branches of the general case, which
 * only the other characters take, cost about twice as much.
 *
 * @returns The UTF-16 code units read and the bytes written.
 */
const encodeUtf8Into = (
  source: string,
  destination: Uint8Array,
): { read: number; written: number } => {
  let read = 0;
  let written = 0;
  while (read < source.length) {
    NON_ASCII_CHARACTERS.lastIndex = read;
    const match = NON_ASCII_CHARACTERS.exec(source);
    const asciiEnd = match === null ? source.length : match.index;
    const copyEnd = Math.min(asciiEnd, read + destination.length - written);
    while (read < copyEnd) {
      destination[written++] = source.charCodeAt(read++);
    }
    if (read < asciiEnd || match === null) break;
    const runEnd = asciiEnd + match[0].length;
    while (read < runEnd) {
      let codePoint = source.charCodeAt(read);
      let units = 1;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
        const next = source.charCodeAt(read + 1);
        if (codePoint <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
          codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
          units = 2;
        } else {
          codePoint = REPLACEMENT_CHARACTER;
        }
      }
      const size = codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
      if (written + size > destination.length) return { read, written };
      if (size === 2) {
        destination[written] = 0xc0 | (codePoint >> 6);
        destination[written + 1] = 0x80 | (codePoint & 0x3f);
      } else if (size === 3) {
        destination[written] = 0xe0 | (codePoint >> 12);
        destination[written + 1] = 0x80 | ((codePoint >> 6) & 0x3f);
        destination[written + 2] = 0x80 | (codePoint & 0x3f);
      } else {
        destination[written] = 0xf0 | (codePoint >> 18);
        destination[written + 1] = 0x80 | ((codePoint >> 12) & 0x3f);
        destination[written + 2] = 0x80 | ((codePoint >> 6) & 0x3f);
        destination[written + 3] = 0x80 | (codePoint & 0x3f);
      }
      written += size;
      read += units;
    }
  }
  return { read, written };
};

export class LynxTextEncoder {
  readonly encoding = 'utf-8';

  encode(input = ''): Uint8Array {
    const text = String(input);
    // ASCII text, which most JSON is, takes a byte a character, so it's
    // encoded straight into a buffer of its length, with no copy after.
    NON_ASCII_CHARACTERS.lastIndex = 0;
    if (!NON_ASCII_CHARACTERS.test(text)) {
      const bytes = new Uint8Array(text.length);
      encodeUtf8Into(text, bytes);
      return bytes;
    }
    // A UTF-16 code unit takes at most three bytes, and a surrogate pair, two
    // units, takes four.
    const bytes = new Uint8Array(text.length * 3);
    return bytes.slice(0, encodeUtf8Into(text, bytes).written);
  }

  encodeInto(
    source: string,
    destination: Uint8Array,
  ): { read: number; written: number } {
    return encodeUtf8Into(String(source), destination);
  }
}

export class LynxTextDecoder {
  readonly encoding = 'utf-8';
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  /** Bytes of a sequence a streaming decode cut off, kept for the next call. */
  #pending: number[] = [];
  /** Whether this stream has produced output yet, so a BOM can only lead it. */
  #started = false;

  constructor(
    label = 'utf-8',
    options: { fatal?: boolean; ignoreBOM?: boolean } = {},
  ) {
    if (!UTF8_LABELS.has(String(label).trim().toLowerCase())) {
      throw new RangeError(
        `The encoding label provided ('${label}') is invalid or isn't supported on Lynx, which only decodes UTF-8.`,
      );
    }
    this.fatal = !!options.fatal;
    this.ignoreBOM = !!options.ignoreBOM;
  }

  decode(input?: BufferSource, options: { stream?: boolean } = {}): string {
    let bytes = toBytes(input);
    if (this.#pending.length > 0) {
      const joined = new Uint8Array(this.#pending.length + bytes.length);
      joined.set(this.#pending);
      joined.set(bytes, this.#pending.length);
      bytes = joined;
    }
    const end = options.stream ? completeLength(bytes) : bytes.length;
    this.#pending = Array.from(bytes.subarray(end));
    let output = this.#decode(bytes, end);
    if (
      !this.ignoreBOM &&
      !this.#started &&
      output.charCodeAt(0) === BYTE_ORDER_MARK
    ) {
      output = output.slice(1);
    }
    this.#started = options.stream ? this.#started || output !== '' : false;
    return output;
  }

  /**
   * The Encoding Standard's UTF-8 decoder: an invalid sequence becomes one
   * U+FFFD, or a TypeError when `fatal`.
   *
   * Most of a response body is usually ASCII, and an ASCII byte decodes to
   * the character with its code. So each slice of bytes becomes a string of
   * one character per byte, through one native `String.fromCharCode` call,
   * and a native regular expression finds its bytes over 0x7f. The ASCII
   * between them is copied out of that string with `slice()`, and only the
   * runs of other bytes are decoded a byte at a time in JavaScript, which on
   * PrimJS (no JIT) took most of a request's main-thread time (issue #880).
   * A multi-byte sequence is all bytes over 0x7f, so a run holds whole
   * sequences, and it ends at the first ASCII byte, even one that breaks a
   * sequence.
   *
   * The pieces are joined once, at the end. In QuickJS, which PrimJS comes
   * from, adding each piece to the output copied all of it every time (no
   * rope strings), so text with a character outside ASCII every few bytes,
   * thousands of pieces, decoded slower than it did a byte at a time.
   */
  #decode(bytes: Uint8Array, end: number): string {
    const parts: string[] = [];
    let index = 0;
    while (index < end) {
      const start = index;
      const sliceEnd = Math.min(end, start + SLICE);
      const latin1 = String.fromCharCode.apply(
        null,
        bytes.subarray(start, sliceEnd) as unknown as number[],
      );
      // Where the ASCII left to copy starts in `latin1`.
      let at = 0;
      for (;;) {
        NON_ASCII_BYTE.lastIndex = at;
        const match = NON_ASCII_BYTE.exec(latin1);
        const asciiEnd = match === null ? latin1.length : match.index;
        parts.push(
          at === 0 && asciiEnd === latin1.length
            ? latin1
            : latin1.slice(at, asciiEnd),
        );
        if (match === null) {
          index = sliceEnd;
          break;
        }
        // A run can carry on past the slice, to finish a sequence or because
        // the text goes on without ASCII (CJK text, say). The next slice
        // starts where it ends.
        index = this.#decodeRun(bytes, start + asciiEnd, end, parts);
        if (index >= sliceEnd) break;
        at = index - start;
      }
    }
    return parts.join('');
  }

  /**
   * Decodes the bytes over 0x7f from `index`, up to the next ASCII byte or
   * `end`, onto `parts`.
   *
   * @returns Where the run ended.
   */
  #decodeRun(
    bytes: Uint8Array,
    index: number,
    end: number,
    parts: string[],
  ): number {
    const codes: number[] = [];
    while (index < end && (bytes[index] as number) >= 0x80) {
      const lead = bytes[index] as number;
      const needed = sequenceLength(lead) - 1;
      // The first continuation byte's valid range narrows for some leads,
      // which rules out overlong encodings and surrogates.
      let lower = lead === 0xe0 ? 0xa0 : lead === 0xf0 ? 0x90 : 0x80;
      let upper = lead === 0xed ? 0x9f : lead === 0xf4 ? 0x8f : 0xbf;
      let codePoint = lead & (0xff >> (needed + 2));
      let seen = 0;
      while (seen < needed && index + 1 + seen < end) {
        const next = bytes[index + 1 + seen] as number;
        if (next < lower || next > upper) break;
        lower = 0x80;
        upper = 0xbf;
        codePoint = (codePoint << 6) | (next & 0x3f);
        seen++;
      }
      if (needed === 0 || seen < needed) {
        if (this.fatal) {
          throw new TypeError(
            "Failed to execute 'decode' on 'TextDecoder': The encoded data was not valid.",
          );
        }
        // The byte that broke the sequence starts the next one.
        codes.push(REPLACEMENT_CHARACTER);
        index += 1 + seen;
      } else {
        if (codePoint > 0xffff) {
          codePoint -= 0x10000;
          codes.push(0xd800 | (codePoint >> 10), 0xdc00 | (codePoint & 0x3ff));
        } else {
          codes.push(codePoint);
        }
        index += 1 + needed;
      }
      // fromCharCode takes its codes as arguments, so a long run is passed
      // on in slices.
      if (codes.length >= SLICE) {
        parts.push(String.fromCharCode.apply(null, codes));
        codes.length = 0;
      }
    }
    parts.push(String.fromCharCode.apply(null, codes));
    return index;
  }
}
