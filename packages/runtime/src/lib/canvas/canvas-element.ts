import { LynxElement } from '../lynx-element/lynx-element';
import type { ElementRef } from '../types/lynx';
import {
  type ContextListener,
  CanvasSurface,
  dispatchContextEvent,
} from './canvas-surface';

/** The context's events, which the canvas fires itself (see getContext). */
const CONTEXT_EVENTS: ReadonlySet<string> = new Set([
  'webglcontextlost',
  'webglcontextrestored',
  'webglcontextcreationerror',
]);

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
 * `<canvas>`: a drawing surface with a 2D or WebGL2 context, as
 * HTMLCanvasElement has, for chart and image libraries, three.js and other
 * WebGL libraries.
 *
 * - `width` and `height` are the drawing buffer's size in pixels (300 by 150
 *   to start, as on the web); the element's CSS size is how big it's shown.
 * - `getContext('2d')` returns a CanvasRenderingContext2D, and
 *   `getContext('webgl2')` a WebGL2RenderingContext: on iOS and Android, the
 *   runtime's (see canvas-2d-context.ts and webgl2-context.ts), drawing with
 *   the shell's Core Graphics or `android.graphics.Canvas`, or its OpenGL ES
 *   3.0; on Lynx for Web, the browser's own, since the element is a real
 *   `<canvas>` there. A canvas keeps the kind of context it was first asked
 *   for, as in a browser. They return null on a host without the shell's
 *   `AngularLynxWebGL` module, such as Lynx Explorer. `'webgl'` (WebGL 1)
 *   is null too.
 * - Pointer events (see pointer-events.ts) and `getBoundingClientRect()`
 *   (see layout.ts) work on every element; a canvas keeps its layout from
 *   the start, so `clientWidth` and `clientHeight` are right after its first
 *   layout.
 * - `webglcontextlost` fires when `WEBGL_lose_context` loses the context,
 *   which three.js does when it's disposed.
 * - It can be drawn with `drawImage()`, made a pattern, or uploaded as a
 *   WebGL texture (three.js's CanvasTexture), as an image is.
 */
export class LynxCanvasElement extends LynxElement {
  readonly #surface: CanvasSurface;
  readonly #contextListeners = new Map<string, Set<ContextListener>>();
  readonly style: Record<string, string>;

  constructor(element: ElementRef) {
    super(element);
    this.tagName = 'canvas';
    this.#surface = new CanvasSurface(this);
    this.#surface.exposeOn(this);
    this.style = __WEB__
      ? ((element as unknown as HTMLElement).style as unknown as Record<
          string,
          string
        >)
      : createStyle(this);
    if (!__WEB__) {
      // Pairs the native view with the context the shell makes for it.
      this.setAttribute('canvas-id', this.#surface.canvasId);
      // Starts following its layout, so clientWidth and clientHeight are
      // right from its first layout on.
      this.getBoundingClientRect();
    }
  }

  get #dom(): HTMLCanvasElement {
    return this.element as unknown as HTMLCanvasElement;
  }

  get width(): number {
    return __WEB__ ? this.#dom.width : this.#surface.width;
  }

  set width(value: number) {
    if (__WEB__) {
      this.#dom.width = value;
      return;
    }
    this.#surface.width = value;
  }

  get height(): number {
    return __WEB__ ? this.#dom.height : this.#surface.height;
  }

  set height(value: number) {
    if (__WEB__) {
      this.#dom.height = value;
      return;
    }
    this.#surface.height = value;
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
   * The id that pairs this canvas with its native view and context.
   */
  get canvasId(): string {
    return this.#surface.canvasId;
  }

  getContext(type: string, attributes?: Record<string, unknown>): unknown {
    if (__WEB__) {
      return this.#dom.getContext(type, attributes);
    }
    return this.#surface.getContext(type, attributes);
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
    return dispatchContextEvent(this, this.#contextListeners, type);
  }

  /**
   * @internal Angular destroyed the element: the context goes with it.
   */
  releaseContext(): void {
    this.#surface.release();
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
    return this.#surface.toDataURL(type, quality);
  }

  /**
   * Encodes the canvas's image as a PNG, or a JPEG for `image/jpeg`, and
   * calls `callback` with it as a `Blob` on a later task, as
   * HTMLCanvasElement's does. `quality` is the JPEG's, from 0 to 1 (0.92
   * otherwise); any type other than `image/jpeg` and `image/png` gives a
   * PNG, as browsers fall back to.
   *
   * It reads the canvas as it is when it's called, as a browser does. A 2D
   * canvas keeps what's drawn on it. WebGL clears the drawing buffer once a
   * frame has been shown, so call it in the task that drew (right after
   * three.js's `render()`), or make the context with
   * `preserveDrawingBuffer: true`; called later, it gives a transparent
   * image. JPEGs have no transparency: transparent pixels come out black, as
   * in browsers.
   *
   * The shell reads and encodes the pixels, so the call blocks the main
   * thread while it does (tens of milliseconds for a photo); the Blob comes
   * back later. The callback gets `null` when there's nothing to encode: a
   * canvas without a context, one whose context is lost, or a host without
   * `<canvas>`, such as Lynx Explorer.
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
    this.#surface.toBlob(callback, type, quality);
  }
}
