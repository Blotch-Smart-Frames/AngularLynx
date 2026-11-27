/**
 * `ImageData`, apart from the 2D context: every app has the global, as a
 * browser does (dom-globals.ts), and WebGL's texImage2D() and
 * createImageBitmap() take one (image.ts), while the 2D context is in the
 * build only when something asks for one (see enable-canvas-2d.ts).
 */

const domError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

/** ImageData: RGBA pixels, not premultiplied, rows top to bottom. */
export class LynxImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace = 'srgb';

  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight: number,
    height?: number | object,
  ) {
    if (typeof dataOrWidth === 'number') {
      const width = Math.floor(dataOrWidth);
      const rows = Math.floor(widthOrHeight);
      if (!(width > 0) || !(rows > 0)) {
        throw domError(
          'IndexSizeError',
          `Failed to construct 'ImageData': The source ${width > 0 ? 'height' : 'width'} is zero or not a number.`,
        );
      }
      this.width = width;
      this.height = rows;
      this.data = new Uint8ClampedArray(width * rows * 4);
      return;
    }
    if (!(dataOrWidth instanceof Uint8ClampedArray)) {
      throw new TypeError(
        "Failed to construct 'ImageData': parameter 1 is not of type 'Uint8ClampedArray'.",
      );
    }
    const width = Math.floor(widthOrHeight);
    const length = dataOrWidth.length;
    if (length === 0 || length % 4 !== 0) {
      throw domError(
        'InvalidStateError',
        "Failed to construct 'ImageData': The input data length is not a multiple of 4.",
      );
    }
    if (!(width > 0) || (length / 4) % width !== 0) {
      throw domError(
        'IndexSizeError',
        "Failed to construct 'ImageData': The input data length is not a multiple of (4 * width).",
      );
    }
    const rows = length / 4 / width;
    if (typeof height === 'number' && Math.floor(height) !== rows) {
      throw domError(
        'IndexSizeError',
        "Failed to construct 'ImageData': The input data length is not equal to (4 * width * height).",
      );
    }
    this.width = width;
    this.height = rows;
    this.data = dataOrWidth;
  }
}
