import { base64ToBytes } from '../network/base64';
import {
  bitmapRendererSettingsFrom,
  LynxImageBitmapRenderingContext,
  type LynxImageBitmapRenderingContextSettings,
} from './bitmap-renderer-context';
import {
  canvas2DAttributesFrom,
  type LynxCanvas2DAttributes,
} from './canvas-2d-attributes';
import type { LynxCanvasRenderingContext2D } from './canvas-2d-context';
import { CANVAS_SOURCE, type CanvasSource } from './canvas-source';
import {
  type Canvas2DBridge,
  type EncodedImage,
  getBitmapRendererBridge,
  getCanvas2DBridge,
  getWebGLBridge,
  type WebGLBridge,
} from './webgl-bridge';
import {
  contextAttributesFrom,
  type LynxWebGLContextAttributes,
  type LynxWebGL2RenderingContext,
} from './webgl2-context';

// A page-unique prefix for canvas ids, so two LynxViews in one app (each with
// its own JavaScript) can't pair a context with the other's canvas.
const ID_PREFIX = `c${Math.floor(Math.random() * 0x7fffffff).toString(36)}`;
let nextCanvasId = 1;
let nextContextId = 1;

/**
 * Makes a canvas's WebGL2 context (see {@link setWebGL2ContextFactory}). The
 * owner is the canvas object the app holds, which the context's `canvas` is.
 */
export type WebGL2ContextFactory = (
  bridge: WebGLBridge,
  contextId: number,
  owner: CanvasOwner,
  attributes: LynxWebGLContextAttributes,
) => LynxWebGL2RenderingContext;

/**
 * What makes a canvas's WebGL2 context, once `ɵenableWebGL2()` (see
 * enable-webgl2.ts) has set it. Until then a canvas has no WebGL2 context to
 * give.
 *
 * The context is 3,000 lines of the runtime (about 37 kB of a minified
 * main-thread script, with its constants), and PrimJS reads a script's whole
 * bytecode when it loads it, so every app paid for it in memory, drawing or
 * not (#707). Constructed here, as it was, it couldn't be left out: every
 * `<canvas>`, `document.createElement('canvas')` and `OffscreenCanvas` has a
 * surface, whatever the app draws with. Through this slot only the modules
 * that name `'webgl2'`, as code that asks for the context does, bring it: the
 * build plugin calls `ɵenableWebGL2()` at the top of each one (on-demand.ts
 * there).
 */
let webGL2ContextFactory: WebGL2ContextFactory | null = null;

/**
 * Whether getContext() has said why it had no WebGL2 context to give, so it
 * says so once rather than on every frame a library asks.
 */
let warnedNotEnabled = false;

/**
 * Makes a canvas's 2D context (see {@link setCanvas2DContextFactory}). The
 * owner is the canvas object the app holds, which the context's `canvas` is.
 */
export type Canvas2DContextFactory = (
  bridge: Canvas2DBridge,
  contextId: number,
  owner: CanvasOwner,
  attributes: LynxCanvas2DAttributes,
) => LynxCanvasRenderingContext2D;

/**
 * What makes a canvas's 2D context, once `ɵenableCanvas2D()` (see
 * enable-canvas-2d.ts) has set it, as {@link webGL2ContextFactory} does for
 * WebGL2. Until then a canvas has no 2D context to give.
 *
 * The context, with its paths and its CSS color, font and filter parsers, is
 * about 40 kB of an unmangled main-thread script, which every app paid for
 * in memory whether it drew or not (#729). Through this slot only the
 * modules that name `'2d'` (or one of the 2D context's classes, such as
 * `Path2D`) bring it: the build plugin calls `ɵenableCanvas2D()` at the top
 * of each one (on-demand.ts there).
 */
let canvas2DContextFactory: Canvas2DContextFactory | null = null;

/** As {@link warnedNotEnabled}, for the 2D context. */
let warned2DNotEnabled = false;

/**
 * @internal Sets what makes a canvas's 2D context (see
 * {@link canvas2DContextFactory}); `null` takes it away again, for tests.
 */
export const setCanvas2DContextFactory = (
  factory: Canvas2DContextFactory | null,
): void => {
  canvas2DContextFactory = factory;
  warned2DNotEnabled = false;
};

/**
 * @internal Sets what makes a canvas's WebGL2 context (see
 * {@link webGL2ContextFactory}); `null` takes it away again, for tests.
 */
export const setWebGL2ContextFactory = (
  factory: WebGL2ContextFactory | null,
): void => {
  webGL2ContextFactory = factory;
  warnedNotEnabled = false;
};

/** The JPEG quality toBlob() and toDataURL() use without one: Chrome's and Firefox's. */
const DEFAULT_JPEG_QUALITY = 0.92;

/**
 * Frees a context's native side when its canvas is garbage-collected, as a
 * browser frees a canvas's context with it. Angular destroying a canvas frees
 * its context at once (see LynxCanvasElement.releaseContext), but only for a
 * canvas at the top of the view it destroys: Angular says nothing of the
 * elements under those. Nor can the runtime free a canvas's context when the
 * view it's shown in goes, since content another view projected into it may
 * be shown again (see LynxElement.markDestroyed). Once nothing can reach the
 * canvas, the context can go. The held value names the context by id, never
 * the canvas, which would keep it alive; the shells' `destroy` ignores an id
 * they've freed already. Null where the engine has no FinalizationRegistry.
 */
const contextFinalizer: FinalizationRegistry<() => void> | null =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry((free) => free())
    : null;

export type ContextListener = (event: {
  type: string;
  preventDefault(): void;
  stopPropagation(): void;
}) => void;

/** Calls a canvas's context listeners; false if one prevented the event. */
export const dispatchContextEvent = (
  target: object,
  listeners: Map<string, Set<ContextListener>>,
  type: string,
): boolean => {
  let prevented = false;
  const event = {
    type,
    target,
    currentTarget: target,
    statusMessage: '',
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
  };
  // A copy: a listener may remove itself as it runs.
  for (const listener of Array.from(listeners.get(type) ?? [])) {
    listener(event);
  }
  return !prevented;
};

/**
 * A canvas's width or height: a whole number of pixels, from 0 to the
 * largest the shells' 32-bit sizes hold, so the size the canvas reports is
 * the size of its bitmap.
 */
const pixelSize = (value: unknown): number =>
  Math.min(0x7fffffff, Math.max(0, Math.floor(Number(value) || 0)));

/**
 * The main thread's `Blob`, which toBlob() and convertToBlob() make. Not
 * every app has one: the build plugin installs it in the apps with a module
 * that names `Blob`, `toBlob` or `convertToBlob` (network/enable.ts), and
 * importing it here would bring it into every app, since every canvas has a
 * surface (#760). So a call reached by a name built at runtime says how to
 * get it, rather than failing on a later task with a ReferenceError.
 */
const blobClass = (): typeof Blob => {
  if (typeof Blob !== 'function') {
    throw new TypeError(
      "This app's main thread has no Blob: no module names Blob, toBlob or convertToBlob. Call ɵenableBlob() from '@blotch/angular-lynx' first.",
    );
  }
  return Blob;
};

/**
 * An encoded image's file, as a Blob.
 */
const blobOf = (
  BlobClass: typeof Blob,
  encoded: { base64: string; type: string },
): Blob =>
  new BlobClass([base64ToBytes(encoded.base64)], { type: encoded.type });

/** The canvas object an app holds, which a context's `canvas` is. */
export type CanvasOwner = {
  readonly width: number;
  readonly height: number;
  /** Fires `webglcontextlost` and the like, which three.js listens for. */
  dispatchContextEvent(type: string): boolean;
};

export type CanvasContext =
  | LynxWebGL2RenderingContext
  | LynxCanvasRenderingContext2D
  | LynxImageBitmapRenderingContext;

/** The kinds of context a canvas can have. */
type ContextType = '2d' | 'webgl2' | 'bitmaprenderer';

const CONTEXT_TYPES: ReadonlySet<string> = new Set<ContextType>([
  '2d',
  'webgl2',
  'bitmaprenderer',
]);

/**
 * The drawing half of a canvas, on iOS and Android: its size in pixels, its
 * context (WebGL2, 2D or bitmaprenderer, the one it was first asked for, as
 * a browser's canvas keeps), and its image as a file. `<canvas>` (canvas-element.ts),
 * `document.createElement('canvas')` and `OffscreenCanvas` (detached-canvas.ts)
 * each have one; only the element has a view to show it in.
 */
export class CanvasSurface {
  /** The id that pairs the canvas with its native view and context. */
  readonly canvasId = `${ID_PREFIX}-${nextCanvasId++}`;
  readonly #owner: CanvasOwner;
  #width = 300;
  #height = 150;
  #context: CanvasContext | null = null;
  #contextType: ContextType | null = null;
  readonly source: CanvasSource;

  constructor(owner: CanvasOwner, width = 300, height = 150) {
    this.#owner = owner;
    this.#width = width;
    this.#height = height;
    // Getters, so a reader sees the canvas's size and context as they are.
    this.source = Object.defineProperties(
      {
        canvasId: this.canvasId,
        flush: () => this.#context?.flush(),
      },
      {
        // A bitmaprenderer canvas reads as the bitmap it shows, whose size
        // is the bitmap's, as its bitmap is in a browser.
        width: {
          get: () =>
            this.#context instanceof LynxImageBitmapRenderingContext
              ? this.#context.bitmapWidth
              : this.#width,
        },
        height: {
          get: () =>
            this.#context instanceof LynxImageBitmapRenderingContext
              ? this.#context.bitmapHeight
              : this.#height,
        },
        readable: {
          get: () => !!this.#context && !this.#context.isContextLost(),
        },
      },
    ) as CanvasSource;
  }

  get width(): number {
    return this.#width;
  }

  set width(value: number) {
    this.#width = pixelSize(value);
    this.#context?.resize(this.#width, this.#height);
  }

  get height(): number {
    return this.#height;
  }

  set height(value: number) {
    this.#height = pixelSize(value);
    this.#context?.resize(this.#width, this.#height);
  }

  getContext(type: string, attributes?: Record<string, unknown>): unknown {
    if (!CONTEXT_TYPES.has(type)) return null;
    // The attributes are read first, as a browser converts them before it
    // looks at the canvas: a getter among them may itself ask for a context.
    const resolved =
      type === '2d'
        ? canvas2DAttributesFrom(attributes as Partial<LynxCanvas2DAttributes>)
        : type === 'bitmaprenderer'
          ? bitmapRendererSettingsFrom(
              attributes as Partial<LynxImageBitmapRenderingContextSettings>,
            )
          : contextAttributesFrom(
              attributes as Partial<LynxWebGLContextAttributes>,
            );
    // A canvas has one kind of context, as in a browser.
    if (this.#contextType && this.#contextType !== type) return null;
    if (this.#context && !this.#context.isContextLost()) return this.#context;
    if (type === '2d') {
      return this.#create2D(resolved as LynxCanvas2DAttributes);
    }
    if (type === 'bitmaprenderer') {
      return this.#createBitmapRenderer(
        resolved as LynxImageBitmapRenderingContextSettings,
      );
    }
    return this.#createWebGL2(resolved as LynxWebGLContextAttributes);
  }

  #createBitmapRenderer(
    resolved: LynxImageBitmapRenderingContextSettings,
  ): LynxImageBitmapRenderingContext | null {
    const bridge = getBitmapRendererBridge();
    if (!bridge) return null;
    const contextId = nextContextId++;
    const created = bridge.createBitmapRenderer(contextId, this.canvasId, {
      alpha: resolved.alpha,
      width: this.#width,
      height: this.#height,
    });
    if (!created.ok) {
      console.warn(
        `[angular-lynx] No bitmaprenderer context on this canvas: ${created.error}`,
      );
      return null;
    }
    const context = new LynxImageBitmapRenderingContext(
      bridge,
      contextId,
      this.#owner,
    );
    this.#context = context;
    this.#contextType = 'bitmaprenderer';
    contextFinalizer?.register(this.#owner, () =>
      bridge.destroyBitmapRenderer(contextId),
    );
    return context;
  }

  #createWebGL2(
    resolved: LynxWebGLContextAttributes,
  ): LynxWebGL2RenderingContext | null {
    const bridge = getWebGLBridge();
    if (!bridge) {
      this.#owner.dispatchContextEvent('webglcontextcreationerror');
      return null;
    }
    const createContext = webGL2ContextFactory;
    if (!createContext) {
      // The build left WebGL2 out: no module it bundled names 'webgl2', as
      // code that asks for the context does (see webGL2ContextFactory).
      // Only a context name built at runtime gets here.
      if (!warnedNotEnabled) {
        warnedNotEnabled = true;
        console.warn(
          "[angular-lynx] getContext('webgl2') has no context to give: the build includes WebGL2 only when a module names 'webgl2', and none did. Write the name out where you call getContext(), or call ɵenableWebGL2() from @blotch/angular-lynx before it.",
        );
      }
      this.#owner.dispatchContextEvent('webglcontextcreationerror');
      return null;
    }
    const contextId = nextContextId++;
    const created = bridge.create(contextId, this.canvasId, {
      ...resolved,
      width: this.#width,
      height: this.#height,
    });
    if (!created.ok) {
      console.warn(`[angular-lynx] No WebGL2 on this canvas: ${created.error}`);
      this.#owner.dispatchContextEvent('webglcontextcreationerror');
      return null;
    }
    const context = createContext(bridge, contextId, this.#owner, resolved);
    this.#context = context;
    this.#contextType = 'webgl2';
    contextFinalizer?.register(this.#owner, () => bridge.destroy(contextId));
    return context;
  }

  #create2D(
    resolved: LynxCanvas2DAttributes,
  ): LynxCanvasRenderingContext2D | null {
    const bridge = getCanvas2DBridge();
    if (!bridge) return null;
    const createContext = canvas2DContextFactory;
    if (!createContext) {
      // The build left the 2D context out: no module it bundled names '2d',
      // as code that asks for the context does (see canvas2DContextFactory).
      // Only a context name built at runtime gets here.
      if (!warned2DNotEnabled) {
        warned2DNotEnabled = true;
        console.warn(
          "[angular-lynx] getContext('2d') has no context to give: the build includes the 2D context only when a module names '2d', and none did. Write the name out where you call getContext(), or call ɵenableCanvas2D() from @blotch/angular-lynx before it.",
        );
      }
      return null;
    }
    const contextId = nextContextId++;
    const created = bridge.create2D(contextId, this.canvasId, {
      alpha: resolved.alpha,
      width: this.#width,
      height: this.#height,
    });
    if (!created.ok) {
      console.warn(
        `[angular-lynx] No 2D context on this canvas: ${created.error}`,
      );
      return null;
    }
    const context = createContext(bridge, contextId, this.#owner, resolved);
    this.#context = context;
    this.#contextType = '2d';
    contextFinalizer?.register(this.#owner, () => bridge.destroy2D(contextId));
    return context;
  }

  /**
   * The context goes, as when Angular destroys the element.
   */
  release(): void {
    this.#context?.destroy();
    this.#context = null;
  }

  /**
   * `OffscreenCanvas.transferToImageBitmap()` took the canvas's image: the
   * shell cleared it, and a bitmaprenderer context is blank again.
   */
  didTransfer(): void {
    if (this.#context instanceof LynxImageBitmapRenderingContext) {
      this.#context.didTransfer();
    }
  }

  /**
   * The canvas's image as a `data:` URL: a PNG, or a JPEG for `image/jpeg`
   * with `quality` from 0 to 1 (0.92 otherwise); `data:,` when there's
   * nothing to read.
   */
  toDataURL(type?: string, quality?: unknown): string {
    const encoded = this.#encode(type, quality);
    return encoded ? `data:${encoded.type};base64,${encoded.base64}` : 'data:,';
  }

  /**
   * The image as a Blob, on a later task, as HTMLCanvasElement's toBlob().
   */
  toBlob(
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: unknown,
  ): void {
    // Read now, so the image is of the canvas as it is at the call; the
    // file's bytes and the Blob are made on a later task, which hands them
    // over, as browsers do.
    const BlobClass = blobClass();
    const encoded = this.#encode(type, quality);
    setTimeout(() => callback(encoded ? blobOf(BlobClass, encoded) : null), 0);
  }

  /**
   * The image as a Blob now, or null when there's nothing to encode.
   */
  blobNow(type?: string, quality?: unknown): Blob | null {
    const BlobClass = blobClass();
    const encoded = this.#encode(type, quality);
    return encoded ? blobOf(BlobClass, encoded) : null;
  }

  /**
   * The canvas as an image file, or null when there's nothing to encode.
   */
  #encode(
    type: string | undefined,
    quality: unknown,
  ): { base64: string; type: string } | null {
    // MIME types are matched without case, and an unknown one means PNG.
    // A browser turns any type into a string first.
    const mime =
      String(type ?? '').toLowerCase() === 'image/jpeg'
        ? 'image/jpeg'
        : 'image/png';
    const jpegQuality =
      typeof quality === 'number' && quality >= 0 && quality <= 1
        ? quality
        : DEFAULT_JPEG_QUALITY;
    const context = this.#context;
    // What a bitmaprenderer canvas shows is the bitmap's size, not the
    // canvas's (see source).
    if (this.source.width === 0 || this.source.height === 0) return null;
    if (context?.isContextLost()) return null;
    // Told apart by the kind it was made as, not its class: the 2D
    // context's class is in the build only when something asks for one.
    const encoded = !context
      ? this.#encodeBlank(mime, jpegQuality)
      : this.#contextType === 'webgl2'
        ? (context as LynxWebGL2RenderingContext).encodeDrawingBuffer(
            mime,
            jpegQuality,
          )
        : (
            context as
              | LynxCanvasRenderingContext2D
              | LynxImageBitmapRenderingContext
          ).encode(mime, jpegQuality);
    if (encoded.base64 === undefined) {
      console.warn(
        `[angular-lynx] The canvas couldn't be encoded: ${encoded.error}`,
      );
      return null;
    }
    return { base64: encoded.base64, type: encoded.type ?? mime };
  }

  /**
   * A canvas nobody asked for a context of encodes as a transparent image
   * of its size, as in a browser: the shell encodes one from a 2D bitmap of
   * its own, which leaves the canvas free to take either kind of context.
   */
  #encodeBlank(type: string, quality: number): EncodedImage {
    const bridge = getCanvas2DBridge();
    if (!bridge) return { error: 'This host has no canvas' };
    const contextId = nextContextId++;
    const created = bridge.create2D(contextId, `${this.canvasId}-blank`, {
      alpha: true,
      width: this.#width,
      height: this.#height,
    });
    if (!created.ok) return { error: created.error };
    try {
      return bridge.encode2D(contextId, { type, quality });
    } finally {
      bridge.destroy2D(contextId);
    }
  }

  /**
   * Puts the canvas's image source on the object an app holds.
   */
  exposeOn(target: object): void {
    Object.defineProperty(target, CANVAS_SOURCE, {
      value: this.source,
      enumerable: false,
    });
  }
}
