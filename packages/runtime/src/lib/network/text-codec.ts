import { utf8Encode } from '../url/percent-encoding';

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

export class LynxTextEncoder {
  readonly encoding = 'utf-8';

  encode(input = ''): Uint8Array {
    return new Uint8Array(utf8Encode(String(input)));
  }

  encodeInto(
    source: string,
    destination: Uint8Array,
  ): { read: number; written: number } {
    let read = 0;
    let written = 0;
    for (const char of String(source)) {
      const bytes = utf8Encode(char);
      if (written + bytes.length > destination.length) break;
      destination.set(bytes, written);
      written += bytes.length;
      read += char.length;
    }
    return { read, written };
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
    let bytes: ArrayLike<number> = toBytes(input);
    if (this.#pending.length > 0) {
      bytes = [...this.#pending, ...Array.from(bytes)];
    }
    const end = options.stream ? completeLength(bytes) : bytes.length;
    this.#pending = Array.from({ length: bytes.length - end }, (_, i) =>
      Number(bytes[end + i]),
    );
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
   * U+FFFD, or a TypeError when `fatal`. Unlike the URL polyfill's
   * utf8Decode(), which only sees short URL parts, it builds the string in
   * slices, since a response body can be megabytes long.
   */
  #decode(bytes: ArrayLike<number>, end: number): string {
    let output = '';
    const codes: number[] = [];
    const invalid = () => {
      if (this.fatal) {
        throw new TypeError(
          "Failed to execute 'decode' on 'TextDecoder': The encoded data was not valid.",
        );
      }
      codes.push(REPLACEMENT_CHARACTER);
    };
    let index = 0;
    while (index < end) {
      const lead = bytes[index] as number;
      if (lead < 0x80) {
        codes.push(lead);
        index++;
      } else {
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
          // The byte that broke the sequence starts the next one.
          invalid();
          index += 1 + seen;
        } else {
          if (codePoint > 0xffff) {
            codePoint -= 0x10000;
            codes.push(
              0xd800 | (codePoint >> 10),
              0xdc00 | (codePoint & 0x3ff),
            );
          } else {
            codes.push(codePoint);
          }
          index += 1 + needed;
        }
      }
      if (codes.length >= SLICE) {
        output += String.fromCharCode(...codes);
        codes.length = 0;
      }
    }
    return output + String.fromCharCode(...codes);
  }
}
