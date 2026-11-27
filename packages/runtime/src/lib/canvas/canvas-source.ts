/**
 * A canvas as an image: what `drawImage()`, `createPattern()` and WebGL's
 * `texImage2D()` read from a `<canvas>`, a canvas made with
 * `document.createElement('canvas')`, or an OffscreenCanvas. The shell reads
 * its pixels by the canvas's id, from its 2D context's bitmap or its WebGL
 * context's drawing buffer, so they never travel through JavaScript.
 *
 * A `<video>` is one too (video-element.ts): the shell's video element
 * registers its latest frame under the video's id, where the contexts read
 * it as they read a canvas.
 */
export type CanvasSource = {
  /** The id the shell knows the canvas's context by. */
  readonly canvasId: string;
  readonly width: number;
  readonly height: number;
  /** Whether it has a context the shell can read. */
  readonly readable: boolean;
  /**
   * Whether it's a `<video>`, which has no size before its first frame and
   * then draws nothing, as in a browser, where a canvas of no size throws.
   */
  readonly video?: boolean;
  /**
   * Sends the calls its context has recorded, so the shell reads the canvas
   * as the app has drawn it so far.
   */
  flush(): void;
};

/** The key under which a canvas exposes its CanvasSource. */
export const CANVAS_SOURCE = Symbol.for('angular-lynx.canvasSource');

export const canvasSourceOf = (source: unknown): CanvasSource | null => {
  if (source === null || typeof source !== 'object') return null;
  return (
    ((source as Record<symbol, unknown>)[CANVAS_SOURCE] as
      | CanvasSource
      | undefined) ?? null
  );
};
