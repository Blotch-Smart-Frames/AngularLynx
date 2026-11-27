/**
 * A 2D context's settings, apart from the context: a canvas reads them in
 * getContext() before it looks for a context to give (canvas-surface.ts),
 * and every canvas has a surface, while the context is in the build only
 * when something asks for one (see enable-canvas-2d.ts).
 */

/** CanvasRenderingContext2DSettings, with the defaults filled in. */
export type LynxCanvas2DAttributes = {
  alpha: boolean;
  colorSpace: 'srgb';
  desynchronized: boolean;
  willReadFrequently: boolean;
};

export const canvas2DAttributesFrom = (
  requested: Partial<LynxCanvas2DAttributes> | undefined,
): LynxCanvas2DAttributes => ({
  alpha: requested?.alpha ?? true,
  // The shells draw in sRGB; display-p3 isn't there.
  colorSpace: 'srgb',
  desynchronized: false,
  willReadFrequently: !!requested?.willReadFrequently,
});
