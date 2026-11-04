/**
 * Bytes as Lynx's native-module bridge carries them, which has no binary
 * type: an `ArrayBuffer` arrives as an empty map, a returned `NSData` crashes
 * the main thread's PrimJS, and a string ends at its first NUL (measured on
 * Lynx 4.1). So bytes cross as an array of their 32-bit little-endian words,
 * zero-padded, with the byte count last: `Array.from(new Uint32Array(...))`
 * builds it at C speed, and every device Lynx runs on is little-endian, so the
 * words land in memory as the bytes were. The WebGL bridge
 * (canvas/webgl-bridge.ts) and the bundled-asset reader (bundled-asset.ts)
 * use it, and the shells' modules read and write it.
 */

/** Bytes to send. The count goes last because appending is O(1). */
export const toWords = (bytes: Uint8Array): number[] => {
  const length = bytes.byteLength;
  let aligned: Uint32Array;
  if (bytes.byteOffset % 4 === 0 && length % 4 === 0) {
    aligned = new Uint32Array(bytes.buffer, bytes.byteOffset, length / 4);
  } else {
    const padded = new Uint8Array(Math.ceil(length / 4) * 4);
    padded.set(bytes);
    aligned = new Uint32Array(padded.buffer);
  }
  const words = Array.from(aligned);
  words.push(length);
  return words;
};

/**
 * A list a native module returned, as a plain array of numbers. On iOS, Lynx
 * hands native arrays back as array-likes that `.map()` reads but a typed
 * array's constructor sees as empty.
 */
export const numbersFrom = (value: unknown): number[] =>
  value && typeof (value as unknown[]).map === 'function'
    ? (value as unknown[]).map(Number)
    : [];

/** Bytes back from words. */
export const fromWords = (words: unknown): Uint8Array => {
  const list = numbersFrom(words);
  const byteLength = list[list.length - 1] ?? 0;
  // The trailing count comes along and is left out of the view.
  return new Uint8Array(new Uint32Array(list).buffer, 0, byteLength);
};
