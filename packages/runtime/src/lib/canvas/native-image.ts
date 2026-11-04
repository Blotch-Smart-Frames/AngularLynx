/**
 * An image decoded by the shell (see webgl-bridge.ts `decodeImage`): what an
 * `ImageBitmap` or an `<img>` made by `new Image()` holds on Lynx, and what
 * `texImage2D` uploads. The pixels stay in native memory, where the GL
 * context reads them, so a texture's bytes never travel through JavaScript.
 */
export type NativeImage = {
  /** The shell's id for the pixels. 0 while there are none. */
  readonly id: number;
  readonly width: number;
  readonly height: number;
  /**
   * Whether the decode already applied the upload's options, as
   * `createImageBitmap()` does: WebGL ignores UNPACK_FLIP_Y_WEBGL and
   * UNPACK_PREMULTIPLY_ALPHA_WEBGL for an ImageBitmap. An `<img>` keeps its
   * pixels as decoded, neither flipped nor premultiplied, and each upload
   * applies them.
   */
  readonly bakedOptions: boolean;
};

/** The key under which an image source exposes its NativeImage. */
export const NATIVE_IMAGE = Symbol.for('angular-lynx.nativeImage');

export const nativeImageOf = (source: unknown): NativeImage | null => {
  if (source === null || typeof source !== 'object') return null;
  return (
    ((source as Record<symbol, unknown>)[NATIVE_IMAGE] as
      | NativeImage
      | undefined) ?? null
  );
};

let nextImageId = 1;

/** A new id for a decode, unique for the page. */
export const nextNativeImageId = (): number => nextImageId++;
