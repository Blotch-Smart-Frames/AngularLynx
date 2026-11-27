import { blobForURL, decodeDataURL, isHeldBlob } from '../network/blob-urls';
import { relayBytes } from '../network/relay';
import { type CanvasSource, canvasSourceOf } from './canvas-source';
import { type WebGLBridge, getWebGLBridge, toWords } from './webgl-bridge';
import {
  NATIVE_IMAGE,
  type NativeImage,
  nextNativeImageId,
} from './native-image';

/**
 * Images for WebGL on Lynx's main thread, which has no DOM to decode them:
 * `createImageBitmap()`, `ImageBitmap`, and an `Image` (an `<img>`) for
 * libraries that load textures through one, as three.js's TextureLoader does.
 *
 * The shell's `AngularLynxWebGL` module decodes the file (`decodeImage`) and
 * keeps the pixels, which `texImage2D` uploads by id (see webgl2-context.ts),
 * so the pixels never travel through JavaScript; the file's bytes do, once.
 * An ImageBitmap of a canvas is a copy the shell makes of the canvas's pixels
 * (`imageFromCanvas`), so nothing at all crosses the bridge but the ids.
 * Where there's no module (Lynx Explorer, tests), decoding fails as a broken
 * image does: `createImageBitmap()` rejects and an `<img>` fires `error`.
 *
 * The decoded pixels go when the image does: `ImageBitmap.close()`, or once
 * the garbage collector drops it.
 */

const releaseImage = (id: number): void => {
  if (id) getWebGLBridge()?.releaseImage(id);
};

const registry =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<number>(releaseImage)
    : null;

type DecodeOptions = {
  imageOrientation?: 'from-image' | 'flipY' | 'none';
  premultiplyAlpha?: 'default' | 'premultiply' | 'none';
  colorSpaceConversion?: 'default' | 'none';
  resizeWidth?: number;
  resizeHeight?: number;
  resizeQuality?: string;
};

/**
 * The module that keeps decoded images, or why there's none.
 */
const imageBridge = (): WebGLBridge => {
  const bridge = getWebGLBridge();
  if (!bridge) {
    throw new Error(
      'Decoding images needs the AngularLynxWebGL module, which apps built with `ng build --platform ios|android` have',
    );
  }
  return bridge;
};

/**
 * Decodes a file's bytes in the shell, into a new image id.
 */
const decode = (
  bytes: Uint8Array,
  options: DecodeOptions,
): { id: number; width: number; height: number } => {
  const bridge = imageBridge();
  const id = nextNativeImageId();
  const decoded = bridge.decodeImage(id, toWords(bytes), {
    imageOrientation: options.imageOrientation ?? 'from-image',
    premultiplyAlpha: options.premultiplyAlpha ?? 'default',
    resizeWidth: options.resizeWidth ?? 0,
    resizeHeight: options.resizeHeight ?? 0,
  });
  if (decoded.error || !decoded.width || !decoded.height) {
    throw new Error(decoded.error ?? 'The image could not be decoded');
  }
  return { id, width: decoded.width, height: decoded.height };
};

/**
 * An image file's bytes, from a URL: an object URL, a data: URL, a file the
 * app bundles or the network.
 */
const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const blob = blobForURL(url);
  if (blob) return blob.bytesSync();
  const data = url.startsWith('data:') ? decodeDataURL(url) : null;
  if (data) return data.bytes;
  // The app's fetch where it has one (the web preview's, a test's, or the
  // relayed one a module that names fetch installs), so the request goes as
  // its own do. Most apps have none on the main thread (network/enable.ts),
  // and an image's request needs only what fetch would do for it.
  if (typeof fetch !== 'function') return relayBytes(url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

/**
 * The key of LynxImageBitmap's method that detaches it and hands over its
 * decoded image. A symbol, so it isn't on `ImageBitmap`'s public API.
 */
export const TAKE_IMAGE = Symbol('takeImage');

/**
 * Decoded pixels in the shell, as `createImageBitmap()` returns: the
 * decode applied its options (orientation, alpha), so WebGL's
 * UNPACK_FLIP_Y_WEBGL and UNPACK_PREMULTIPLY_ALPHA_WEBGL don't touch it.
 */
export class LynxImageBitmap {
  #image: NativeImage;
  /**
   * Closed, or handed to a canvas by transferFromImageBitmap(): the HTML
   * spec's [[Detached]], which a bitmap of no pixels isn't.
   */
  #detached = false;

  /**
   * @internal Made by createImageBitmap().
   */
  constructor(id: number, width: number, height: number) {
    this.#image = { id, width, height, bakedOptions: true };
    registry?.register(this, id, this);
  }

  get width(): number {
    return this.#image.width;
  }

  get height(): number {
    return this.#image.height;
  }

  get [NATIVE_IMAGE](): NativeImage {
    return this.#image;
  }

  close(): void {
    this.#detached = true;
    if (!this.#image.id) return;
    registry?.unregister(this);
    releaseImage(this.#image.id);
    this.#image = { id: 0, width: 0, height: 0, bakedOptions: true };
  }

  /**
   * @internal Detaches the bitmap and gives its decoded image to the
   * caller, for transferFromImageBitmap(): the shell's pixels are the
   * caller's to free now, so the bitmap no longer frees them when it's
   * collected. Null for a bitmap that's detached already.
   */
  [TAKE_IMAGE](): NativeImage | null {
    if (this.#detached) return null;
    const image = this.#image;
    this.#detached = true;
    registry?.unregister(this);
    this.#image = { id: 0, width: 0, height: 0, bakedOptions: true };
    return image;
  }
}

/**
 * An ImageBitmap of a canvas's pixels as they are now, with
 * createImageBitmap()'s options applied. The shell copies them, by the
 * canvas's id, from its 2D bitmap or its WebGL drawing buffer, into a new
 * image of its own, which is the bitmap's; the canvas can go on drawing, or
 * go. With `transfer`, the canvas's bitmap is cleared after it's read, as
 * `OffscreenCanvas.transferToImageBitmap()` hands its image over.
 *
 * @internal For createImageBitmap() and transferToImageBitmap().
 */
export const imageBitmapOfCanvas = (
  canvas: CanvasSource,
  options: DecodeOptions,
  transfer: boolean,
): LynxImageBitmap => {
  const bridge = imageBridge();
  // The calls the canvas's context has recorded go first, so the copy is of
  // the canvas as the app has drawn it so far, as a browser reads it.
  canvas.flush();
  const id = nextNativeImageId();
  const image = bridge.imageFromCanvas(id, canvas.canvasId, {
    imageOrientation: options.imageOrientation ?? 'from-image',
    premultiplyAlpha: options.premultiplyAlpha ?? 'default',
    resizeWidth: options.resizeWidth ?? 0,
    resizeHeight: options.resizeHeight ?? 0,
    // For a canvas without a context, which the shell has no pixels of: its
    // image is transparent black, of its size, as in a browser.
    width: canvas.width,
    height: canvas.height,
    transfer,
  });
  if (image.error || !image.width || !image.height) {
    throw new Error(image.error ?? 'The canvas could not be read');
  }
  return new LynxImageBitmap(id, image.width, image.height);
};

/**
 * A resize option as Web IDL's `[EnforceRange] unsigned long` converts it
 * (`'8'` is 8, 8.7 is 8), so the shell gets a number. One outside that range
 * is a TypeError, and a resize to no pixels is refused, as a browser does,
 * before an omitted size becomes 0 ("keep the source's") on its way to the
 * shell.
 */
const resizeOption = (value: unknown, member: string): number | undefined => {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= -1 || number >= 2 ** 32) {
    throw new TypeError(
      `Failed to execute 'createImageBitmap' on 'Window': Failed to read the '${member}' property from 'ImageBitmapOptions': Value is outside the 'unsigned long' value range.`,
    );
  }
  const size = Math.trunc(number);
  if (size === 0) {
    const error = new Error(
      `Failed to execute 'createImageBitmap' on 'Window': The ${member} is equal to 0.`,
    );
    error.name = 'InvalidStateError';
    throw error;
  }
  return size;
};

/**
 * `createImageBitmap()`, from a Blob (a file's bytes), an image that has
 * loaded, or a canvas (`<canvas>`, `document.createElement('canvas')` or an
 * OffscreenCanvas). Cropping (the `sx, sy, sw, sh` arguments) isn't
 * supported.
 */
export const createImageBitmap = async (
  source: unknown,
  ...rest: unknown[]
): Promise<LynxImageBitmap> => {
  if (rest.length > 1) {
    throw new Error('createImageBitmap() cropping is not supported on Lynx');
  }
  const given = (rest[0] ?? {}) as DecodeOptions;
  // Each option read by name, as Web IDL reads a dictionary: a spread would
  // drop the ones an object inherits.
  const options: DecodeOptions = {
    imageOrientation: given.imageOrientation,
    premultiplyAlpha: given.premultiplyAlpha,
    resizeWidth: resizeOption(given.resizeWidth, 'resizeWidth'),
    resizeHeight: resizeOption(given.resizeHeight, 'resizeHeight'),
  };
  const canvas = canvasSourceOf(source);
  if (canvas) {
    // Read before anything is awaited, so the bitmap is of the canvas as it
    // is at the call, as a browser takes it.
    if (canvas.width === 0 || canvas.height === 0) {
      const error = new Error(
        `Failed to execute 'createImageBitmap' on 'Window': The source image ${canvas.width === 0 ? 'width' : 'height'} is 0.`,
      );
      error.name = 'InvalidStateError';
      throw error;
    }
    return imageBitmapOfCanvas(canvas, options, false);
  }
  let bytes: Uint8Array;
  if (isHeldBlob(source)) {
    bytes = source.bytesSync();
  } else if (source instanceof LynxImageElement) {
    bytes = await source.fileBytes();
  } else if (source && typeof (source as Blob).arrayBuffer === 'function') {
    bytes = new Uint8Array(await (source as Blob).arrayBuffer());
  } else {
    throw new TypeError(
      'createImageBitmap() on Lynx takes a Blob, a loaded Image or a canvas',
    );
  }
  const { id, width, height } = decode(bytes, options);
  return new LynxImageBitmap(id, width, height);
};

type ImageListener = (event: { type: string; target: unknown }) => void;

/**
 * An `<img>` for loading textures, as `new Image()` and
 * `document.createElement('img')` make on the web: set `src`, wait for
 * `load`, and pass it to `texImage2D`. Its pixels are kept as decoded, so
 * WebGL's flip and premultiply settings apply when it's uploaded, as they do
 * to an `<img>`. It isn't an element on the page: use `<image>` to show one.
 */
export class LynxImageElement {
  #src = '';
  #image: NativeImage = { id: 0, width: 0, height: 0, bakedOptions: false };
  #bytes: Uint8Array | null = null;
  #complete = true;
  #load = 0;
  readonly #listeners = new Map<string, Set<ImageListener>>();
  width = 0;
  height = 0;
  crossOrigin: string | null = null;
  decoding = 'auto';
  fetchPriority = 'auto';
  alt = '';
  onload: ImageListener | null = null;
  onerror: ImageListener | null = null;
  readonly tagName = 'IMG';
  readonly nodeName = 'IMG';

  constructor(width?: number, height?: number) {
    if (width !== undefined) this.width = width;
    if (height !== undefined) this.height = height;
    registry?.register(this, 0, this);
  }

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = String(value);
    const load = ++this.#load;
    this.#complete = false;
    void this.#start(load);
  }

  get complete(): boolean {
    return this.#complete;
  }

  get naturalWidth(): number {
    return this.#image.width;
  }

  get naturalHeight(): number {
    return this.#image.height;
  }

  get [NATIVE_IMAGE](): NativeImage {
    return this.#image;
  }

  /**
   * @internal The file's bytes, for createImageBitmap().
   */
  async fileBytes(): Promise<Uint8Array> {
    // decode() resolves only once a load set the bytes.
    await this.decode();
    return this.#bytes!;
  }

  async #start(load: number): Promise<void> {
    try {
      const bytes = await fetchBytes(this.#src);
      if (load !== this.#load) return;
      const { id, width, height } = decode(bytes, {
        imageOrientation: 'none',
        premultiplyAlpha: 'none',
      });
      releaseImage(this.#image.id);
      registry?.unregister(this);
      registry?.register(this, id, this);
      this.#image = { id, width, height, bakedOptions: false };
      this.#bytes = bytes;
      if (!this.width) this.width = width;
      if (!this.height) this.height = height;
      this.#complete = true;
      this.#fire('load');
    } catch (error) {
      if (load !== this.#load) return;
      this.#complete = true;
      console.warn(`[angular-lynx] Image ${this.#src} failed to load:`, error);
      this.#fire('error');
    }
  }

  decode(): Promise<void> {
    if (this.#complete) {
      return this.#image.id
        ? Promise.resolve()
        : Promise.reject(new Error('The image could not be decoded'));
    }
    return new Promise((resolve, reject) => {
      const done = () => {
        this.removeEventListener('load', done);
        this.removeEventListener('error', failed);
        resolve();
      };
      const failed = () => {
        this.removeEventListener('load', done);
        this.removeEventListener('error', failed);
        reject(new Error('The image could not be decoded'));
      };
      this.addEventListener('load', done);
      this.addEventListener('error', failed);
    });
  }

  addEventListener(type: string, listener: ImageListener): void {
    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: ImageListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  setAttribute(name: string, value: string): void {
    (this as unknown as Record<string, string>)[name] = value;
  }

  getAttribute(name: string): string | null {
    const value = (this as unknown as Record<string, unknown>)[name];
    return value === undefined || value === null ? null : String(value);
  }

  #fire(type: string): void {
    const event = { type, target: this };
    const handler = type === 'load' ? this.onload : this.onerror;
    handler?.call(this, event);
    // A copy: a listener may remove itself as it runs.
    for (const listener of Array.from(this.#listeners.get(type) ?? [])) {
      listener.call(this, event);
    }
  }
}
