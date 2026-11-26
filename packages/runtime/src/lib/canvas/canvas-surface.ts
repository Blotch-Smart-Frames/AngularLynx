import { base64ToBytes } from '../network/base64';
import {
  canvas2DAttributesFrom,
  type LynxCanvas2DAttributes,
  LynxCanvasRenderingContext2D,
} from './canvas-2d-context';
import { CANVAS_SOURCE, type CanvasSource } from './canvas-source';
import { getCanvas2DBridge, getWebGLBridge } from './webgl-bridge';
import {
  contextAttributesFrom,
  type LynxWebGLContextAttributes,
  LynxWebGL2RenderingContext,
} from './webgl2-context';

// A page-unique prefix for canvas ids, so two LynxViews in one app (each with
// its own JavaScript) can't pair a context with the other's canvas.
const ID_PREFIX = `c${Math.floor(Math.random() * 0x7fffffff).toString(36)}`;
let nextCanvasId = 1;
let nextContextId = 1;

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

/** The canvas object an app holds, which a context's `canvas` is. */
export type CanvasOwner = {
  readonly width: number;
  readonly height: number;
  /** Fires `webglcontextlost` and the like, which three.js listens for. */
  dispatchContextEvent(type: string): boolean;
};

export type CanvasContext =
  | LynxWebGL2RenderingContext
  | LynxCanvasRenderingContext2D;

/**
 * The drawing half of a canvas, on iOS and Android: its size in pixels, its
 * context (WebGL2 or 2D, the one it was first asked for, as a browser's
 * canvas keeps), and its image as a file. `<canvas>` (canvas-element.ts),
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
  #contextType: '2d' | 'webgl2' | null = null;
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
        width: { get: () => this.#width },
        height: { get: () => this.#height },
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
    this.#width = Math.max(0, Math.floor(Number(value) || 0));
    this.#context?.resize(this.#width, this.#height);
  }

  get height(): number {
    return this.#height;
  }

  set height(value: number) {
    this.#height = Math.max(0, Math.floor(Number(value) || 0));
    this.#context?.resize(this.#width, this.#height);
  }

  getContext(type: string, attributes?: Record<string, unknown>): unknown {
    if (type !== 'webgl2' && type !== '2d') return null;
    // A canvas has one kind of context, as in a browser.
    if (this.#contextType && this.#contextType !== type) return null;
    if (this.#context && !this.#context.isContextLost()) return this.#context;
    return type === '2d'
      ? this.#create2D(attributes as Partial<LynxCanvas2DAttributes>)
      : this.#createWebGL2(attributes as Partial<LynxWebGLContextAttributes>);
  }

  #createWebGL2(
    attributes: Partial<LynxWebGLContextAttributes> | undefined,
  ): LynxWebGL2RenderingContext | null {
    const bridge = getWebGLBridge();
    if (!bridge) {
      this.#owner.dispatchContextEvent('webglcontextcreationerror');
      return null;
    }
    const contextId = nextContextId++;
    const resolved = contextAttributesFrom(attributes);
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
    const context = new LynxWebGL2RenderingContext(
      bridge,
      contextId,
      this.#owner,
      resolved,
    );
    this.#context = context;
    this.#contextType = 'webgl2';
    contextFinalizer?.register(this.#owner, () => bridge.destroy(contextId));
    return context;
  }

  #create2D(
    attributes: Partial<LynxCanvas2DAttributes> | undefined,
  ): LynxCanvasRenderingContext2D | null {
    const bridge = getCanvas2DBridge();
    if (!bridge) return null;
    const contextId = nextContextId++;
    const resolved = canvas2DAttributesFrom(attributes);
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
    const context = new LynxCanvasRenderingContext2D(
      bridge,
      contextId,
      this.#owner,
      resolved,
    );
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
    // Read now, so the image is of the canvas as it is at the call, and
    // handed over on a later task, as browsers do.
    const blob = this.blobNow(type, quality);
    setTimeout(() => callback(blob), 0);
  }

  /**
   * The image as a Blob now, or null when there's nothing to encode.
   */
  blobNow(type?: string, quality?: unknown): Blob | null {
    const encoded = this.#encode(type, quality);
    return encoded
      ? (new Blob([base64ToBytes(encoded.base64)], {
          type: encoded.type,
        }) as Blob)
      : null;
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
    if (
      this.#width === 0 ||
      this.#height === 0 ||
      !context ||
      context.isContextLost()
    ) {
      return null;
    }
    const encoded =
      context instanceof LynxCanvasRenderingContext2D
        ? context.encode(mime, jpegQuality)
        : context.encodeDrawingBuffer(mime, jpegQuality);
    if (encoded.base64 === undefined) {
      console.warn(
        `[angular-lynx] The canvas couldn't be encoded: ${encoded.error}`,
      );
      return null;
    }
    return { base64: encoded.base64, type: encoded.type ?? mime };
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
