import {
  definePolyfills,
  isObject,
  typedArrayName,
  typedArrayLength,
} from './shared.js';

// ES2026 Uint8Array to and from base64 and hex.
const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64URL = BASE64.slice(0, 62) + '-_';
const ALPHABETS = ['base64', 'base64url'];
const LAST_CHUNK_HANDLINGS = ['loose', 'strict', 'stop-before-partial'];
const requireOptions = (options) => {
  if (options !== undefined && !isObject(options)) {
    throw new TypeError('Options must be an object');
  }
};
/**
 * Reads an option once; the first of `values` is its default.
 */
const readOption = (options, name, values) => {
  const value = options === undefined ? undefined : options[name];
  if (value === undefined) return values[0];
  if (!values.includes(value)) throw new TypeError(`Invalid ${name} option`);
  return value;
};
const skipAsciiWhitespace = (string, index) => {
  while (index < string.length && '\t\n\f\r '.includes(string[index])) index++;
  return index;
};
/**
 * DecodeBase64Chunk: two to four characters of the standard alphabet into one
 * to three bytes. In strict mode, the bits a short chunk doesn't use must be
 * zero.
 */
const decodeBase64Chunk = (chunk, strict, bytes) => {
  let n = 0;
  for (const char of (chunk + 'AA').slice(0, 4)) {
    n = n * 64 + BASE64.indexOf(char);
  }
  const decoded = [n >> 16, (n >> 8) & 255, n & 255];
  const count = chunk.length - 1;
  if (strict && count < 3 && decoded[count] !== 0) {
    return new SyntaxError('Extra bits in a base64 chunk');
  }
  for (let index = 0; index < count; index++) bytes.push(decoded[index]);
  return undefined;
};
/**
 * FromBase64, step for step: decodes up to `maxLength` bytes, and reports how
 * many characters it read. An error comes back with the bytes decoded before
 * it, which setFromBase64 still writes.
 */
const decodeBase64 = (string, alphabet, lastChunkHandling, maxLength) => {
  const bytes = [];
  let read = 0;
  let chunk = '';
  let index = 0;
  const result = (error) => ({ read, bytes, error });
  const syntaxError = () => result(new SyntaxError('Invalid base64 string'));
  if (maxLength === 0) return result();
  for (;;) {
    index = skipAsciiWhitespace(string, index);
    if (index === string.length) {
      if (chunk.length > 0) {
        if (lastChunkHandling === 'stop-before-partial') return result();
        if (lastChunkHandling === 'strict' || chunk.length === 1) {
          return syntaxError();
        }
        decodeBase64Chunk(chunk, false, bytes);
      }
      read = string.length;
      return result();
    }
    let char = string[index++];
    if (char === '=') {
      if (chunk.length < 2) return syntaxError();
      index = skipAsciiWhitespace(string, index);
      if (chunk.length === 2) {
        if (index === string.length) {
          return lastChunkHandling === 'stop-before-partial'
            ? result()
            : syntaxError();
        }
        if (string[index] === '=') {
          index = skipAsciiWhitespace(string, index + 1);
        }
      }
      if (index < string.length) return syntaxError();
      const error = decodeBase64Chunk(
        chunk,
        lastChunkHandling === 'strict',
        bytes,
      );
      if (error) return result(error);
      read = string.length;
      return result();
    }
    if (alphabet === 'base64url') {
      if (char === '+' || char === '/') return syntaxError();
      if (char === '-') char = '+';
      else if (char === '_') char = '/';
    }
    if (!BASE64.includes(char)) return syntaxError();
    // Stop before a chunk whose bytes wouldn't fit.
    const remaining = maxLength - bytes.length;
    if (
      (remaining === 1 && chunk.length === 2) ||
      (remaining === 2 && chunk.length === 3)
    ) {
      return result();
    }
    chunk += char;
    if (chunk.length === 4) {
      decodeBase64Chunk(chunk, false, bytes);
      chunk = '';
      read = index;
      if (bytes.length === maxLength) return result();
    }
  }
};
/**
 * FromHex: pairs of hex digits, up to `maxLength` bytes.
 */
const decodeHex = (string, maxLength) => {
  const bytes = [];
  let read = 0;
  if (string.length % 2 !== 0) {
    return {
      read,
      bytes,
      error: new SyntaxError('A hex string must have an even length'),
    };
  }
  while (read < string.length && bytes.length < maxLength) {
    const pair = string.slice(read, read + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
      return { read, bytes, error: new SyntaxError('Invalid hex string') };
    }
    read += 2;
    bytes.push(parseInt(pair, 16));
  }
  return { read, bytes, error: undefined };
};
const requireString = (value) => {
  if (typeof value !== 'string') throw new TypeError('Expected a string');
};
const requireUint8Array = (value) => {
  if (typedArrayName.call(value) !== 'Uint8Array') {
    throw new TypeError('Expected a Uint8Array');
  }
};
/**
 * The setFrom* methods write what they decoded, even before an error, and
 * report how much of the string they read and how many bytes they wrote.
 */
const writeDecoded = (target, { read, bytes, error }) => {
  for (let index = 0; index < bytes.length; index++)
    target[index] = bytes[index];
  if (error) throw error;
  return { read, written: bytes.length };
};

if (typeof Uint8Array === 'function') {
  definePolyfills(Uint8Array, {
    fromBase64(string) {
      requireString(string);
      const options = arguments[1];
      requireOptions(options);
      const alphabet = readOption(options, 'alphabet', ALPHABETS);
      const lastChunkHandling = readOption(
        options,
        'lastChunkHandling',
        LAST_CHUNK_HANDLINGS,
      );
      const { bytes, error } = decodeBase64(
        string,
        alphabet,
        lastChunkHandling,
        Infinity,
      );
      if (error) throw error;
      return new Uint8Array(bytes);
    },
    fromHex(string) {
      requireString(string);
      const { bytes, error } = decodeHex(string, Infinity);
      if (error) throw error;
      return new Uint8Array(bytes);
    },
  });
  definePolyfills(Uint8Array.prototype, {
    toBase64() {
      requireUint8Array(this);
      const options = arguments[0];
      requireOptions(options);
      const table =
        readOption(options, 'alphabet', ALPHABETS) === 'base64'
          ? BASE64
          : BASE64URL;
      const padding = options !== undefined && options.omitPadding ? '' : '=';
      const length = typedArrayLength.call(this);
      let encoded = '';
      for (let index = 0; index < length; index += 3) {
        const left = length - index;
        const n =
          (this[index] << 16) |
          (left > 1 ? this[index + 1] << 8 : 0) |
          (left > 2 ? this[index + 2] : 0);
        encoded +=
          table[n >> 18] +
          table[(n >> 12) & 63] +
          (left > 1 ? table[(n >> 6) & 63] : padding) +
          (left > 2 ? table[n & 63] : padding);
      }
      return encoded;
    },
    toHex() {
      requireUint8Array(this);
      const length = typedArrayLength.call(this);
      let hex = '';
      for (let index = 0; index < length; index++) {
        hex += this[index].toString(16).padStart(2, '0');
      }
      return hex;
    },
    setFromBase64(string) {
      requireUint8Array(this);
      requireString(string);
      const options = arguments[1];
      requireOptions(options);
      const alphabet = readOption(options, 'alphabet', ALPHABETS);
      const lastChunkHandling = readOption(
        options,
        'lastChunkHandling',
        LAST_CHUNK_HANDLINGS,
      );
      return writeDecoded(
        this,
        decodeBase64(
          string,
          alphabet,
          lastChunkHandling,
          typedArrayLength.call(this),
        ),
      );
    },
    setFromHex(string) {
      requireUint8Array(this);
      requireString(string);
      return writeDecoded(this, decodeHex(string, typedArrayLength.call(this)));
    },
  });
}
