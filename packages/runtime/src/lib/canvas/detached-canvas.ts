import {
  type ContextListener,
  CanvasSurface,
  dispatchContextEvent,
} from './canvas-surface';

/**
 * What `document.createElement('canvas')` and `new OffscreenCanvas()` share:
 * a canvas with no view, drawn on with a 2D or WebGL2 context and read back
 * as an image, as web code does to draw text for a three.js texture, resize
 * a photo, or measure text. It can be drawn on another canvas, made a
 * pattern, uploaded as a texture and encoded as a file; nothing shows it.
 */
abstract class LynxCanvasBase {
  /** @internal */
  readonly surface: CanvasSurface;
  readonly #listeners = new Map<string, Set<ContextListener>>();

  constructor(width: number, height: number) {
    this.surface = new CanvasSurface(this, width, height);
    this.surface.exposeOn(this);
  }

  get width(): number {
    return this.surface.width;
  }
  set width(value: number) {
    this.surface.width = value;
  }

  get height(): number {
    return this.surface.height;
  }
  set height(value: number) {
    this.surface.height = value;
  }

  getContext(type: string, attributes?: Record<string, unknown>): unknown {
    return this.surface.getContext(type, attributes);
  }

  addEventListener(name: string, listener: ContextListener): void {
    let listeners = this.#listeners.get(name);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(name, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(name: string, listener: ContextListener): void {
    this.#listeners.get(name)?.delete(listener);
  }

  /**
   * @internal Fires one of the context's events; false if one prevented it.
   */
  dispatchContextEvent(type: string): boolean {
    return dispatchContextEvent(this, this.#listeners, type);
  }
}

/**
 * `document.createElement('canvas')` on Lynx's main thread: an
 * HTMLCanvasElement that isn't in a template, so has no view. Its `style`
 * holds what's set on it and does nothing, as on a canvas that's never put
 * in the page.
 */
export class LynxDetachedCanvas extends LynxCanvasBase {
  readonly tagName = 'CANVAS';
  readonly nodeName = 'CANVAS';
  readonly style: Record<string, string> = {};

  constructor() {
    super(300, 150);
  }

  toDataURL(type?: string, quality?: unknown): string {
    return this.surface.toDataURL(type, quality);
  }

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
    this.surface.toBlob(callback, type, quality);
  }

  setAttribute(name: string, value: unknown): void {
    if (name === 'width' || name === 'height') this[name] = Number(value);
  }

  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    };
  }
}

/**
 * `OffscreenCanvas`: a canvas of a given size, with no view, whose image
 * `convertToBlob()` gives as a file.
 */
export class LynxOffscreenCanvas extends LynxCanvasBase {
  constructor(width: number, height: number) {
    super(
      offscreenSize(width, 'constructor'),
      offscreenSize(height, 'constructor'),
    );
  }

  override get width(): number {
    return this.surface.width;
  }
  override set width(value: number) {
    this.surface.width = offscreenSize(value, 'width');
  }

  override get height(): number {
    return this.surface.height;
  }
  override set height(value: number) {
    this.surface.height = offscreenSize(value, 'height');
  }

  convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob> {
    if (this.width === 0 || this.height === 0) {
      const error = new Error(
        "Failed to execute 'convertToBlob' on 'OffscreenCanvas': The size of the OffscreenCanvas is zero.",
      );
      error.name = 'IndexSizeError';
      return Promise.reject(error);
    }
    const blob = this.surface.blobNow(options?.type, options?.quality);
    if (blob) return Promise.resolve(blob);
    const error = new Error(
      "Failed to execute 'convertToBlob' on 'OffscreenCanvas': The canvas couldn't be encoded.",
    );
    error.name = 'EncodingError';
    return Promise.reject(error);
  }

  transferToImageBitmap(): never {
    throw new Error(
      'OffscreenCanvas.transferToImageBitmap() is not available on Lynx: draw the OffscreenCanvas itself with drawImage() or texImage2D()',
    );
  }
}

/**
 * OffscreenCanvas's sizes are `[EnforceRange] unsigned long long`: a
 * TypeError for one that's negative or not finite, truncated otherwise.
 */
const offscreenSize = (value: unknown, member: string): number => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= -1) {
    const where =
      member === 'constructor'
        ? "Failed to construct 'OffscreenCanvas'"
        : `Failed to set the '${member}' property on 'OffscreenCanvas'`;
    throw new TypeError(
      `${where}: Value is outside the 'unsigned long long' value range.`,
    );
  }
  return Math.trunc(number);
};
