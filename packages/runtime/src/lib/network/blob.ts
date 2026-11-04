import { LynxTextDecoder, LynxTextEncoder } from './text-codec';
import { LynxReadableStream } from './readable-stream';

/**
 * `Blob` and object URLs for Lynx's main thread, which has neither.
 *
 * three.js's glTF loader makes a Blob of each image a `.glb` file holds,
 * gives it an object URL (`URL.createObjectURL`) and loads that URL like any
 * other, through `fetch` or an `<img>`. `response.blob()` and HttpClient's
 * `responseType: 'blob'` need the class too. A Blob here holds its bytes in
 * memory, so it reads back at once; an object URL is a key into a map of
 * them, which the main thread's `fetch` (fetch.ts) and `Image` (canvas/image.ts)
 * look up instead of making a request.
 */

type BlobPart = ArrayBuffer | ArrayBufferView | LynxBlob | string;

const bytesOfPart = (part: BlobPart): Uint8Array => {
  if (typeof part === 'string') return new LynxTextEncoder().encode(part);
  if (part instanceof LynxBlob) return part.bytesSync();
  if (part instanceof ArrayBuffer) return new Uint8Array(part);
  if (ArrayBuffer.isView(part)) {
    return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
  }
  return new LynxTextEncoder().encode(String(part));
};

export class LynxBlob {
  readonly #bytes: Uint8Array;
  readonly type: string;

  constructor(parts: BlobPart[] = [], options: { type?: string } = {}) {
    const chunks = parts.map(bytesOfPart);
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.#bytes = bytes;
    // The spec lowercases the type, and drops one that isn't printable ASCII.
    const type = options.type ?? '';
    this.type = /^[\x20-\x7e]*$/.test(type) ? type.toLowerCase() : '';
  }

  get size(): number {
    return this.#bytes.byteLength;
  }

  /**
   * @internal The bytes, without copying or waiting: they're in memory.
   */
  bytesSync(): Uint8Array {
    return this.#bytes;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.#bytes.slice().buffer as ArrayBuffer;
  }

  async bytes(): Promise<Uint8Array> {
    return this.#bytes.slice();
  }

  async text(): Promise<string> {
    return new LynxTextDecoder().decode(this.#bytes);
  }

  slice(start = 0, end = this.size, type = ''): LynxBlob {
    const clamp = (value: number) =>
      value < 0 ? Math.max(this.size + value, 0) : Math.min(value, this.size);
    return new LynxBlob([this.#bytes.slice(clamp(start), clamp(end))], {
      type,
    });
  }

  stream(): LynxReadableStream<Uint8Array> {
    const bytes = this.#bytes.slice();
    return new LynxReadableStream<Uint8Array>({
      start: (controller) => {
        if (bytes.byteLength > 0) controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  get [Symbol.toStringTag](): string {
    return 'Blob';
  }
}

const objectURLs = new Map<string, LynxBlob>();
let nextObjectURL = 1;

/** `URL.createObjectURL()`: a `blob:` URL for the blob, until it's revoked. */
export const createObjectURL = (blob: LynxBlob): string => {
  const url = `blob:lynx/${nextObjectURL++}`;
  objectURLs.set(url, blob);
  return url;
};

export const revokeObjectURL = (url: string): void => {
  objectURLs.delete(url);
};

/** The blob an object URL names, or undefined once it's revoked. */
export const blobForURL = (url: string): LynxBlob | undefined =>
  objectURLs.get(url);

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
    bytes: new LynxTextEncoder().encode(decodeURIComponent(data)),
    type: type || 'text/plain;charset=US-ASCII',
  };
};
