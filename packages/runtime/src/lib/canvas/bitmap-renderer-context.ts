import { LynxImageBitmap, TAKE_IMAGE } from './image';
import type { BitmapRendererBridge, EncodedImage } from './webgl-bridge';

/** The canvas a bitmaprenderer context shows its bitmap in, as it sees it. */
export type BitmapRendererHost = {
  readonly width: number;
  readonly height: number;
};

/** ImageBitmapRenderingContextSettings, with the default filled in. */
export type LynxImageBitmapRenderingContextSettings = {
  alpha: boolean;
};

/**
 * The settings `getContext('bitmaprenderer', settings)` asks for, read as
 * Web IDL reads the dictionary: by name, so an inherited `alpha` counts, and
 * converted to a boolean.
 */
export const bitmapRendererSettingsFrom = (
  requested: Partial<LynxImageBitmapRenderingContextSettings> | undefined,
): LynxImageBitmapRenderingContextSettings => {
  const alpha = requested?.alpha;
  return { alpha: alpha === undefined ? true : !!alpha };
};

const domError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

/**
 * `<canvas>`'s `getContext('bitmaprenderer')` on Lynx: the
 * ImageBitmapRenderingContext web code shows an OffscreenCanvas's frames
 * with, `offscreen.transferToImageBitmap()` then
 * `visible.getContext('bitmaprenderer').transferFromImageBitmap(bitmap)`.
 *
 * The shell keeps an ImageBitmap's pixels by image id (see image.ts), so
 * `transferFromImageBitmap()` hands the canvas that id. The shell shows those
 * pixels in the canvas's view, as it shows a 2D context's bitmap, and owns
 * them from then on, as the spec detaches the bitmap: nothing crosses the
 * bridge but the id. The canvas shows the bitmap at its own size, scaled to
 * the element's box, whatever the canvas's `width` and `height` are, and it
 * reads as that bitmap when it's drawn, uploaded as a texture or encoded.
 */
export class LynxImageBitmapRenderingContext {
  readonly #canvas: BitmapRendererHost;
  readonly #bridge: BitmapRendererBridge;
  readonly #id: number;
  /**
   * The spec's bitmap mode: blank (a transparent bitmap the canvas's size)
   * until a bitmap is transferred, and again after `null` is.
   */
  #blank = true;
  #width: number;
  #height: number;
  #destroyed = false;

  /**
   * @internal Made by a canvas's getContext('bitmaprenderer'), once the
   * shell made its side, which shows a blank canvas of the canvas's size.
   */
  constructor(
    bridge: BitmapRendererBridge,
    contextId: number,
    canvas: BitmapRendererHost,
  ) {
    this.#bridge = bridge;
    this.#id = contextId;
    this.#canvas = canvas;
    this.#width = canvas.width;
    this.#height = canvas.height;
  }

  /**
   * The canvas the context shows its bitmap in.
   */
  get canvas(): BitmapRendererHost {
    return this.#canvas;
  }

  /**
   * Shows `bitmap` in the canvas, without copying it, and detaches it: its
   * `width` and `height` are 0 from then on, and it can't be drawn or
   * transferred again. `null` clears the canvas to transparent black (opaque
   * black for a context made with `alpha: false`), the canvas's size.
   */
  transferFromImageBitmap(bitmap: LynxImageBitmap | null): void;
  transferFromImageBitmap(...args: unknown[]): void {
    // The arguments as a list, so a call without one throws as Web IDL has
    // a required argument do, which `undefined` (converted to null) doesn't.
    if (args.length === 0) {
      throw new TypeError(
        "Failed to execute 'transferFromImageBitmap' on 'ImageBitmapRenderingContext': 1 argument required, but only 0 present.",
      );
    }
    // `ImageBitmap?`: undefined converts to null, as Web IDL has it.
    const bitmap = args[0] ?? null;
    if (bitmap === null) {
      this.#showBlank();
      return;
    }
    if (!(bitmap instanceof LynxImageBitmap)) {
      throw new TypeError(
        "Failed to execute 'transferFromImageBitmap' on 'ImageBitmapRenderingContext': parameter 1 is not of type 'ImageBitmap'.",
      );
    }
    const image = bitmap[TAKE_IMAGE]();
    if (!image) {
      throw domError(
        'InvalidStateError',
        "Failed to execute 'transferFromImageBitmap' on 'ImageBitmapRenderingContext': The input ImageBitmap has been detached.",
      );
    }
    this.#blank = false;
    this.#width = image.width;
    this.#height = image.height;
    // The shell takes the image whether or not the context is still there,
    // so a destroyed canvas's transfer frees it rather than leaking it. A
    // bitmap of no pixels has no image: it shows nothing.
    const shown = this.#bridge.transferToBitmapRenderer(
      this.#id,
      image.id,
      image.width,
      image.height,
    );
    if (!shown.ok && !this.#destroyed) {
      console.warn(
        `[angular-lynx] The canvas couldn't show the ImageBitmap: ${shown.error}`,
      );
    }
  }

  /**
   * The spec's "set an ImageBitmapRenderingContext's output bitmap" with no
   * bitmap: a transparent one, the canvas's size.
   */
  #showBlank(): void {
    this.#blank = true;
    this.#width = this.#canvas.width;
    this.#height = this.#canvas.height;
    if (this.#destroyed) return;
    this.#bridge.transferToBitmapRenderer(
      this.#id,
      0,
      this.#width,
      this.#height,
    );
  }

  /**
   * @internal The size of what the canvas shows: the bitmap's, or the
   * canvas's while it's blank. A canvas reads as this when it's drawn.
   */
  get bitmapWidth(): number {
    return this.#width;
  }

  /**
   * @internal See {@link bitmapWidth}.
   */
  get bitmapHeight(): number {
    return this.#height;
  }

  /**
   * @internal The context's calls go to the shell as they're made: there's
   * nothing to send.
   */
  flush(): void {}

  /**
   * @internal The canvas changed size: a blank canvas takes the new size, as
   * the spec has it; a bitmap stays as it was.
   */
  resize(_width: number, _height: number): void {
    if (this.#blank) this.#showBlank();
  }

  /**
   * @internal `OffscreenCanvas.transferToImageBitmap()` took what the canvas
   * showed: it's blank now.
   */
  didTransfer(): void {
    this.#showBlank();
  }

  /**
   * @internal The canvas went: so does the shell's side, and the bitmap it
   * owned.
   */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#bridge.destroyBitmapRenderer(this.#id);
  }

  /**
   * @internal For canvas.toBlob() and toDataURL(): what the canvas shows.
   */
  encode(type: string, quality: number): EncodedImage {
    if (this.#destroyed) return { error: 'The canvas has no bitmaprenderer' };
    return this.#bridge.encodeBitmapRenderer(this.#id, { type, quality });
  }

  /**
   * @internal A bitmaprenderer context isn't lost.
   */
  isContextLost(): boolean {
    return false;
  }
}
