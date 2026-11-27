import { utf8Encode } from '../url/percent-encoding';
import { bytesToBase64 } from './base64';

/**
 * The URLs that name bytes this thread holds: object URLs
 * (`URL.createObjectURL()`) and `data:` URLs.
 *
 * Apart from blob.ts because code every app runs reads them: the canvas's
 * `Image` and `createImageBitmap()` (canvas/image.ts) and an `<image>`'s
 * `src` (lynx-element.ts). Importing them from blob.ts brought `LynxBlob`
 * into every app's main-thread script, and with it `TextEncoder`,
 * `TextDecoder` and `ReadableStream`, which PrimJS reads whole as it loads
 * the script (#760). `Blob` itself comes only into the apps that ask for it
 * (enable.ts), and its blobs are what the URLs here name.
 */

/**
 * What the code here needs of a Blob: blob.ts's `LynxBlob`, which holds its
 * bytes in memory.
 */
export type HeldBlob = {
  readonly type: string;
  readonly size: number;
  /** The bytes, without copying or waiting. */
  bytesSync(): Uint8Array;
};

/**
 * The runtime's own Blobs, which blob.ts adds as it makes each, so
 * `isHeldBlob()` can tell one without `instanceof LynxBlob`, which would
 * bring the class along. Weak, so a Blob still goes when nothing holds it.
 */
const heldBlobs = new WeakSet<object>();

/** @internal Called by each `LynxBlob` as it's made. */
export const registerHeldBlob = (blob: HeldBlob): void => {
  heldBlobs.add(blob);
};

/** Whether a value is one of the runtime's Blobs, whose bytes it can read at once. */
export const isHeldBlob = (value: unknown): value is HeldBlob =>
  typeof value === 'object' && value !== null && heldBlobs.has(value);

const objectURLs = new Map<string, HeldBlob>();
let nextObjectURL = 1;

/** `URL.createObjectURL()`: a `blob:` URL for the blob, until it's revoked. */
export const createObjectURL = (blob: HeldBlob): string => {
  const url = `blob:lynx/${nextObjectURL++}`;
  objectURLs.set(url, blob);
  return url;
};

export const revokeObjectURL = (url: string): void => {
  objectURLs.delete(url);
};

/** The blob an object URL names, or undefined once it's revoked. */
export const blobForURL = (url: string): HeldBlob | undefined =>
  objectURLs.get(url);

/**
 * Gives `URL` object URLs (`URL.createObjectURL()` and `revokeObjectURL()`),
 * unless it has them, as the web preview's does. In every app, unlike `Blob`
 * (enable.ts): they're a few lines, and their map is here for `Image` and
 * `<image>` to read anyway.
 *
 * @param target - The global object.
 */
export const installObjectURLs = (target: Record<string, unknown>): void => {
  const url = target['URL'] as
    | { createObjectURL?: unknown; revokeObjectURL?: unknown }
    | undefined;
  if (url && typeof url.createObjectURL !== 'function') {
    url.createObjectURL = createObjectURL;
    url.revokeObjectURL = revokeObjectURL;
  }
};

/**
 * The `data:` URL of the blob an object URL names, for an `<image>`'s `src`,
 * or undefined for any other URL. Lynx's `<image>` loads its own URLs, so a
 * `blob:` URL only this thread knows would show nothing; a data: URL holds
 * the bytes themselves. It's what lets `URL.createObjectURL(picked.blob)`
 * show a photo LynxImagePicker picked, as it would in a browser.
 */
export const dataURLForObjectURL = (url: string): string | undefined => {
  const blob = url.startsWith('blob:') ? objectURLs.get(url) : undefined;
  if (!blob) return undefined;
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(blob.bytesSync())}`;
};

/**
 * A `data:` URL's bytes and type, for `fetch` and `Image`: Lynx's own fetch
 * may not read them, and they need no request.
 */
export const decodeDataURL = (
  url: string,
): { bytes: Uint8Array; type: string } | null => {
  const match = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  const [, type, base64, data] = match;
  if (base64) {
    const binary = atob(data.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, type: type || 'text/plain;charset=US-ASCII' };
  }
  return {
    // utf8Encode() rather than a TextEncoder, which not every app has: it's
    // what LynxTextEncoder encodes with, and every app has it for URL.
    bytes: new Uint8Array(utf8Encode(decodeURIComponent(data))),
    type: type || 'text/plain;charset=US-ASCII',
  };
};
