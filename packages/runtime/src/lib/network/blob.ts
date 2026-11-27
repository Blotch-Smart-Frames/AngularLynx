import { isHeldBlob, registerHeldBlob } from './blob-urls';
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
 * look up instead of making a request. The map is in blob-urls.ts, which
 * code every app runs can read without bringing this class (#760).
 */

type BlobPart = ArrayBuffer | ArrayBufferView | LynxBlob | string;

const bytesOfPart = (part: BlobPart): Uint8Array => {
  if (typeof part === 'string') return new LynxTextEncoder().encode(part);
  // isHeldBlob() rather than `instanceof LynxBlob`: with this function and
  // the class naming each other, and SWC hoisting the class's
  // `[Symbol.toStringTag]` key out of it as a call, the minifier kept the
  // class, and the stream and decoder it uses, in every app's main-thread
  // script, used or not (#760).
  if (isHeldBlob(part)) return part.bytesSync();
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
    // So createImageBitmap() reads its bytes at once (isHeldBlob()).
    registerHeldBlob(this);
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
