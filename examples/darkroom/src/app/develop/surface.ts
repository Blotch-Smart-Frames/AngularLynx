import type { LynxCanvasElement } from '@blotch/angular-lynx';
import { DevelopRenderer } from './develop-renderer';

/** Sharper than this is wasted on a phone and costs fill rate. */
const MAX_PIXEL_RATIO = 2;

/**
 * A canvas that develops photos: its WebGL2 context and renderer, its
 * drawing buffer kept at its laid-out size, and redraws coalesced to one a
 * frame, so a slider that moves ten times between frames draws once.
 *
 * `renderer` is null where there's no WebGL: Lynx Explorer has no canvas,
 * only the apps `ng build --platform` makes and the web preview do.
 */
export class DevelopSurface {
  readonly renderer: DevelopRenderer | null;
  readonly canvas: HTMLCanvasElement;
  /** The drawing buffer's size, in pixels. */
  width = 0;
  height = 0;
  /** How many buffer pixels to one layout pixel. */
  ratio = 1;

  readonly #draw: () => void;
  readonly #resize: ResizeObserver | null = null;
  #frame = 0;

  constructor(element: LynxCanvasElement, draw: () => void) {
    // The canvas stands in for an HTMLCanvasElement, as three.js takes it.
    this.canvas = element as unknown as HTMLCanvasElement;
    this.#draw = draw;
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      // Nothing is drawn over the photo by GL, so its alpha is the photo's.
      premultipliedAlpha: false,
    });
    this.renderer = gl ? new DevelopRenderer(gl) : null;
    if (!this.renderer) return;
    this.ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    // The buffer follows the element's layout, which settles after the
    // first render and changes when the phone rotates.
    this.#resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      this.#setSize(width, height);
    });
    this.#resize.observe(this.canvas);
    this.#setSize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  /**
   * The canvas's layout size, in layout pixels.
   */
  get cssWidth(): number {
    return this.width / this.ratio;
  }
  get cssHeight(): number {
    return this.height / this.ratio;
  }

  /**
   * Draws on the next frame; more calls before then draw once.
   */
  schedule(): void {
    if (!this.renderer || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#draw();
    });
  }

  /**
   * Draws at once, at another size, and hands back the canvas as a JPEG.
   * The buffer is resized, drawn and read in one task, then put back and
   * drawn again before the screen next updates, so the full-size frame is
   * never shown. `toBlob()` reads what's drawn when it's called.
   */
  exportJpeg(
    width: number,
    height: number,
    drawAt: (width: number, height: number) => void,
  ): Promise<Blob | null> {
    const { canvas } = this;
    const [screenWidth, screenHeight] = [this.width, this.height];
    canvas.width = width;
    canvas.height = height;
    drawAt(width, height);
    const result = new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    canvas.width = screenWidth;
    canvas.height = screenHeight;
    this.#draw();
    return result;
  }

  dispose(): void {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#resize?.disconnect();
    this.renderer?.dispose();
  }

  #setSize(cssWidth: number, cssHeight: number): void {
    const width = Math.round(cssWidth * this.ratio);
    const height = Math.round(cssHeight * this.ratio);
    if (!width || !height) return;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.schedule();
  }
}

/**
 * Loads a photo for a texture: a bundled one by its URL, or one the person
 * picked by its object URL. Resolves with its pixel size, which the layout
 * and the export need.
 */
export const loadImage = (
  src: string,
): Promise<{ image: HTMLImageElement; width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    image.onerror = () => reject(new Error(`Couldn't load ${src}`));
    image.src = src;
  });
