import { LynxElement } from '../lynx-element/lynx-element';
import { base64ToBytes } from '../network/base64';
import type { ElementRef } from '../types/lynx';
import { getWebGLBridge } from './webgl-bridge';
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

/** The context's events, which the canvas fires itself (see getContext). */
const CONTEXT_EVENTS: ReadonlySet<string> = new Set([
  'webglcontextlost',
  'webglcontextrestored',
  'webglcontextcreationerror',
]);

/**
 * Frees a context's GL side when its canvas is garbage-collected, as a
 * browser frees a canvas's context with it. Angular destroying a canvas frees
 * its context at once (see releaseContext), but only for a canvas at the top
 * of the view it destroys: Angular says nothing of the elements under those.
 * Nor can the runtime free a canvas's context when the view it's shown in
 * goes, since content another view projected into it may be shown again
 * (see LynxElement.markDestroyed). Once nothing can reach the canvas, the
 * context can go. The held value names the context by id, never the canvas,
 * which would keep it alive; the shells' `destroy` ignores an id they've
 * freed already. Null where the engine has no FinalizationRegistry.
 */
const contextFinalizer: FinalizationRegistry<() => void> | null =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry((free) => free())
    : null;

type ContextListener = (event: {
  type: string;
  preventDefault(): void;
}) => void;

const kebab = (name: string): string =>
  name.startsWith('--')
    ? name
    : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * The `style` of a canvas, as three.js writes it: `canvas.style.width = '…px'`
 * sets the element's width, through the renderer path every style takes.
 */
const createStyle = (element: LynxElement): Record<string, string> => {
  const values: Record<string, string> = {};
  return new Proxy(values, {
    get: (target, name) => {
      if (name === 'setProperty') {
        return (property: string, value: string | null) => {
          target[property] = value ?? '';
          if (value === null || value === '') element.removeStyle(property);
          else element.setStyle(property, value);
        };
      }
      if (name === 'removeProperty') {
        return (property: string) => {
          const old = target[property] ?? '';
          delete target[property];
          element.removeStyle(property);
          return old;
        };
      }
      if (name === 'getPropertyValue') {
        return (property: string) => target[property] ?? '';
      }
      return typeof name === 'string' ? (target[kebab(name)] ?? '') : undefined;
    },
    set: (target, name, value) => {
      if (typeof name !== 'string') return false;
      const property = kebab(name);
      const text = value === null || value === undefined ? '' : String(value);
      target[property] = text;
      if (text === '') element.removeStyle(property);
      else element.setStyle(property, text);
      return true;
    },
  });
};

/**
 * `<canvas>`: a drawing surface with a WebGL2 context, as HTMLCanvasElement
 * has, for three.js and other WebGL libraries.
 *
 * - `width` and `height` are the drawing buffer's size in pixels (300 by 150
 *   to start, as on the web); the element's CSS size is how big it's shown.
 * - `getContext('webgl2')` returns a WebGL2RenderingContext: on iOS and
 *   Android, the runtime's (see webgl2-context.ts), drawing with the shell's
 *   OpenGL ES 3.0; on Lynx for Web, the browser's own, since the element is a
 *   real `<canvas>` there. It returns null where there's no WebGL: a host
 *   without the shell's `AngularLynxWebGL` module, such as Lynx Explorer.
 *   There's no `'2d'` context, and `'webgl'` (WebGL 1) is null too.
 * - Pointer events (see pointer-events.ts) and `getBoundingClientRect()`
 *   (see layout.ts) work on every element; a canvas keeps its layout from
 *   the start, so `clientWidth` and `clientHeight` are right after its first
 *   layout.
 * - `webglcontextlost` fires when `WEBGL_lose_context` loses the context,
 *   which three.js does when it's disposed.
 */
export class LynxCanvasElement extends LynxElement {
  readonly #canvasId = `${ID_PREFIX}-${nextCanvasId++}`;
  #width = 300;
  #height = 150;
  #context: LynxWebGL2RenderingContext | null = null;
  readonly #contextListeners = new Map<string, Set<ContextListener>>();
  readonly style: Record<string, string>;

  constructor(element: ElementRef) {
    super(element);
    this.tagName = 'canvas';
    this.style = __WEB__
      ? ((element as unknown as HTMLElement).style as unknown as Record<
          string,
          string
        >)
      : createStyle(this);
    if (!__WEB__) {
      // Pairs the native view with the context the shell makes for it.
      this.setAttribute('canvas-id', this.#canvasId);
      // Starts following its layout, so clientWidth and clientHeight are
      // right from its first layout on.
      this.getBoundingClientRect();
    }
  }

  get #dom(): HTMLCanvasElement {
    return this.element as unknown as HTMLCanvasElement;
  }

  get width(): number {
    return __WEB__ ? this.#dom.width : this.#width;
  }

  set width(value: number) {
    if (__WEB__) {
      this.#dom.width = value;
      return;
    }
    this.#width = Math.max(0, Math.floor(Number(value) || 0));
    this.#context?.resize(this.#width, this.#height);
  }

  get height(): number {
    return __WEB__ ? this.#dom.height : this.#height;
  }

  set height(value: number) {
    if (__WEB__) {
      this.#dom.height = value;
      return;
    }
    this.#height = Math.max(0, Math.floor(Number(value) || 0));
    this.#context?.resize(this.#width, this.#height);
  }

  /**
   * `width="600"` in a template, or a `[width]` binding, sizes the drawing
   * buffer, as on an HTML canvas; it's not an attribute Lynx knows.
   */
  override setAttribute(name: string, value: any): void {
    if (!__WEB__ && (name === 'width' || name === 'height')) {
      this[name] = Number(value);
      return;
    }
    super.setAttribute(name, value);
  }

  override setProperty(name: string, value: any): void {
    if (name === 'width' || name === 'height') {
      this[name] = Number(value);
      return;
    }
    super.setProperty(name, value);
  }

  /**
   * The id that pairs this canvas with its native view and GL context.
   */
  get canvasId(): string {
    return this.#canvasId;
  }

  getContext(
    type: string,
    attributes?: Partial<LynxWebGLContextAttributes>,
  ): unknown {
    if (__WEB__) {
      return this.#dom.getContext(type, attributes as WebGLContextAttributes);
    }
    if (type !== 'webgl2') return null;
    if (this.#context && !this.#context.isContextLost()) return this.#context;
    const bridge = getWebGLBridge();
    if (!bridge) {
      this.dispatchContextEvent('webglcontextcreationerror');
      return null;
    }
    const contextId = nextContextId++;
    const resolved = contextAttributesFrom(attributes);
    const created = bridge.create(contextId, this.#canvasId, {
      ...resolved,
      width: this.#width,
      height: this.#height,
    });
    if (!created.ok) {
      console.warn(`[angular-lynx] No WebGL2 on this canvas: ${created.error}`);
      this.dispatchContextEvent('webglcontextcreationerror');
      return null;
    }
    this.#context = new LynxWebGL2RenderingContext(
      bridge,
      contextId,
      this,
      resolved,
    );
    contextFinalizer?.register(this, () => bridge.destroy(contextId));
    return this.#context;
  }

  override addEventListener(name: string, cb: (event: any) => any) {
    if (!__WEB__ && CONTEXT_EVENTS.has(name)) {
      let listeners = this.#contextListeners.get(name);
      if (!listeners) {
        listeners = new Set();
        this.#contextListeners.set(name, listeners);
      }
      listeners.add(cb);
      return () => listeners.delete(cb);
    }
    return super.addEventListener(name, cb);
  }

  override removeEventListener(name: string, cb: (event: any) => any): void {
    if (!__WEB__ && CONTEXT_EVENTS.has(name)) {
      this.#contextListeners.get(name)?.delete(cb);
      return;
    }
    super.removeEventListener(name, cb);
  }

  /**
   * @internal Fires one of the context's events; false if one prevented it.
   */
  dispatchContextEvent(type: string): boolean {
    let prevented = false;
    const event = {
      type,
      target: this,
      currentTarget: this,
      statusMessage: '',
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {},
    };
    // A copy: a listener may remove itself as it runs.
    for (const listener of Array.from(this.#contextListeners.get(type) ?? [])) {
      listener(event);
    }
    return !prevented;
  }

  /**
   * @internal Angular destroyed the element: the GL context goes with it.
   */
  releaseContext(): void {
    this.#context?.destroy();
    this.#context = null;
  }

  /**
   * The canvas's image as a `data:` URL, as HTMLCanvasElement's: a PNG, or a
   * JPEG for `image/jpeg` with `quality` from 0 to 1 (0.92 otherwise, as in
   * Chrome and Firefox). Any other type gives a PNG, as browsers fall back
   * to. See {@link toBlob} for what it reads; `data:,` when there's nothing
   * to read.
   */
  toDataURL(type?: string, quality?: unknown): string {
    // The browser's canvas takes any quality, as the spec has it, and
    // ignores one that isn't a number from 0 to 1: its types say number.
    if (__WEB__) return this.#dom.toDataURL(type, quality as number);
    const encoded = this.#encode(type, quality);
    return encoded ? `data:${encoded.type};base64,${encoded.base64}` : 'data:,';
  }

  /**
   * Encodes the canvas's image as a PNG, or a JPEG for `image/jpeg`, and
   * calls `callback` with it as a `Blob` on a later task, as
   * HTMLCanvasElement's does. `quality` is the JPEG's, from 0 to 1 (0.92
   * otherwise); any type other than `image/jpeg` and `image/png` gives a
   * PNG, as browsers fall back to.
   *
   * It reads the drawing buffer as it is when it's called, as a browser
   * does. WebGL clears the drawing buffer once a frame has been shown, so
   * call it in the task that drew (right after three.js's `render()`), or
   * make the context with `preserveDrawingBuffer: true`; called later, it
   * gives a transparent image. JPEGs have no transparency: transparent
   * pixels come out black, as in browsers.
   *
   * The shell reads and encodes the pixels, so the call blocks the main
   * thread while it does (tens of milliseconds for a photo); the Blob comes
   * back later. The callback gets `null` when there's nothing to encode: a
   * canvas without a WebGL context, one whose context is lost, or a host
   * without `<canvas>`, such as Lynx Explorer.
   */
  toBlob(
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: unknown,
  ): void {
    if (typeof callback !== 'function') {
      throw new TypeError(
        "Failed to execute 'toBlob' on 'HTMLCanvasElement': The callback provided as parameter 1 is not a function.",
      );
    }
    if (__WEB__) {
      // The canvas is the page's, so its Blob is of the page's realm, which
      // `instanceof Blob` in the app's iframe wouldn't see as a Blob. One of
      // this realm holds the same bytes.
      this.#dom.toBlob(
        (blob) => callback(blob ? new Blob([blob], { type: blob.type }) : null),
        type,
        quality as number,
      );
      return;
    }
    // Read now, so the image is of the canvas as it is at the call, and
    // handed over on a later task, as browsers do.
    const encoded = this.#encode(type, quality);
    setTimeout(() => {
      callback(
        encoded
          ? (new Blob([base64ToBytes(encoded.base64)], {
              type: encoded.type,
            }) as Blob)
          : null,
      );
    }, 0);
  }

  /**
   * The drawing buffer as an image file, or null when there's nothing to
   * encode.
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
    const encoded = context.encodeDrawingBuffer(mime, jpegQuality);
    if (encoded.base64 === undefined) {
      console.warn(
        `[angular-lynx] The canvas couldn't be encoded: ${encoded.error}`,
      );
      return null;
    }
    return { base64: encoded.base64, type: encoded.type ?? mime };
  }
}
