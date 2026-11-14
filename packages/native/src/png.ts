import { closeSync, openSync, readSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { PNG as PngClass } from 'pngjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Reads a PNG's dimensions from its header, without decoding it. Enough to
 * reject an icon of the wrong size before Xcode's asset compiler does, with a
 * clearer message.
 */
export const readPngSize = (
  file: string,
): { readonly width: number; readonly height: number } => {
  const header = Buffer.alloc(24);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  // The IHDR chunk always comes first: 8-byte signature, 4-byte length,
  // "IHDR", then width and height.
  if (
    !header.subarray(0, 8).equals(SIGNATURE) ||
    header.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error(`${file} is not a PNG file.`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
};

/**
 * pngjs, loaded the first time an image is resized rather than with this
 * module. Only Android's icons and a splash image need it, and CI builds the
 * iOS app, which has no splash image, from this package's tarball unpacked
 * without its dependencies (packages/e2e's README), which works as long as
 * that path loads nothing but Node's built-ins.
 */
const pngjs = (): typeof PngClass =>
  (createRequire(import.meta.url)('pngjs') as { PNG: typeof PngClass }).PNG;

/** A decoded image: 8-bit RGBA rows, top to bottom, not premultiplied. */
export type Image = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

/**
 * Decodes a PNG of any color type and bit depth (palette, grayscale, 16-bit,
 * interlaced) into 8-bit RGBA. pngjs is plain JavaScript, so this runs
 * wherever Node does: Android builds don't need a Mac, so the icon can't be
 * resized with macOS's `sips` the way an Xcode build could.
 */
export const decodePng = (bytes: Buffer): Image => {
  const png = pngjs().sync.read(bytes);
  return { width: png.width, height: png.height, data: png.data };
};

export const encodePng = (image: Image): Buffer =>
  pngjs().sync.write(
    Object.assign(new (pngjs())({ width: image.width, height: image.height }), {
      data: Buffer.from(
        image.data.buffer,
        image.data.byteOffset,
        image.data.byteLength,
      ),
    }),
  );

/**
 * Scales an image to `width`×`height` by averaging the source pixels each
 * output pixel covers (a box filter, weighted by the fraction of each pixel
 * covered). For the big reductions icons need (1024 px to 48), that keeps
 * every source pixel's contribution, where bilinear sampling would skip most
 * of them and alias thin lines.
 *
 * It averages premultiplied colors, so the color of a fully transparent
 * pixel (often black) doesn't bleed into the edge of a shape next to it.
 */
export const resize = (image: Image, width: number, height: number): Image => {
  // Separable: rows first, then columns, which is the same average as over
  // each output pixel's rectangle, at a fraction of the work.
  const rows = resizeAxis(
    premultiply(image),
    image.width,
    width,
    image.height,
    true,
  );
  const both = resizeAxis(rows, image.height, height, width, false);

  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height * 4; i += 4) {
    const alpha = both[i + 3]!;
    const unpremultiply = alpha > 0 ? 1 / alpha : 0;
    data[i] = toByte(both[i]! * unpremultiply);
    data[i + 1] = toByte(both[i + 1]! * unpremultiply);
    data[i + 2] = toByte(both[i + 2]! * unpremultiply);
    data[i + 3] = toByte(alpha * 255);
  }
  return { width, height, data };
};

/**
 * Each image's premultiplied pixels, kept while the image is: the generator
 * resizes one icon to a dozen sizes.
 */
const premultipliedCache = new WeakMap<Image, Float32Array>();

const premultiply = (image: Image): Float32Array => {
  const cached = premultipliedCache.get(image);
  if (cached) {
    return cached;
  }
  const pixels = new Float32Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3]! / 255;
    pixels[i] = image.data[i]! * alpha;
    pixels[i + 1] = image.data[i + 1]! * alpha;
    pixels[i + 2] = image.data[i + 2]! * alpha;
    pixels[i + 3] = alpha;
  }
  premultipliedCache.set(image, pixels);
  return pixels;
};

/**
 * Box-filters one axis of an image `lines` pixels across the other axis.
 * Rows (`horizontal`) are `from` pixels long going in and `to` coming out.
 * Columns are `from` pixels tall going in and `to` coming out, and `lines`
 * is the width, both before and after, since rows were resized first.
 */
const resizeAxis = (
  pixels: Float32Array,
  from: number,
  to: number,
  lines: number,
  horizontal: boolean,
): Float32Array => {
  const scale = from / to;
  // Which source pixels each output pixel covers, and by how much: output
  // pixel i reads `tapCount[i]` source pixels from `tapStart[i]`, with
  // their weights in `weights` from `tapOffset[i]`. Flat typed arrays keep
  // the loop below, run for every pixel of every line, free of objects.
  const tapStart = new Int32Array(to);
  const tapCount = new Int32Array(to);
  const tapOffset = new Int32Array(to);
  const weights: number[] = [];
  for (let i = 0; i < to; i++) {
    const start = i * scale;
    const end = start + scale;
    const first = Math.floor(start);
    const last = Math.min(Math.ceil(end), from);
    tapStart[i] = first;
    tapCount[i] = last - first;
    tapOffset[i] = weights.length;
    for (let j = first; j < last; j++) {
      weights.push((Math.min(end, j + 1) - Math.max(start, j)) / scale);
    }
  }
  const weight = Float32Array.from(weights);
  // How far apart, in floats, neighboring pixels along the axis are, and
  // where each line starts, in the input and the output.
  const step = horizontal ? 4 : lines * 4;
  const inLine = horizontal ? from * 4 : 4;
  const outLine = horizontal ? to * 4 : 4;

  const out = new Float32Array(to * lines * 4);
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < to; i++) {
      const target = line * outLine + i * step;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let source = line * inLine + tapStart[i]! * step;
      for (let k = 0, w = tapOffset[i]!; k < tapCount[i]!; k++, w++) {
        const factor = weight[w]!;
        r += pixels[source]! * factor;
        g += pixels[source + 1]! * factor;
        b += pixels[source + 2]! * factor;
        a += pixels[source + 3]! * factor;
        source += step;
      }
      out[target] = r;
      out[target + 1] = g;
      out[target + 2] = b;
      out[target + 3] = a;
    }
  }
  return out;
};

const toByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

/**
 * Adds `inset` pixels on every side, each a copy of the nearest edge pixel.
 * An adaptive icon layer is 108 dp, but the launcher shows only about the
 * middle 72 and moves the layer around under its mask, so the margin must
 * continue the picture rather than show a frame of another color.
 */
export const extendEdges = (image: Image, inset: number): Image => {
  const width = image.width + inset * 2;
  const height = image.height + inset * 2;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.max(0, y - inset));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.max(0, x - inset));
      const source = (sourceY * image.width + sourceX) * 4;
      data.set(image.data.subarray(source, source + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
};

/**
 * Puts the image in the middle of a transparent `width`×`height` canvas, at
 * least as big as the image. An odd pixel of margin goes right and below.
 */
export const centerOnCanvas = (
  image: Image,
  width: number,
  height: number,
): Image => {
  const data = new Uint8Array(width * height * 4);
  const left = Math.floor((width - image.width) / 2);
  const top = Math.floor((height - image.height) / 2);
  for (let y = 0; y < image.height; y++) {
    const row = y * image.width * 4;
    data.set(
      image.data.subarray(row, row + image.width * 4),
      ((top + y) * width + left) * 4,
    );
  }
  return { width, height, data };
};

/**
 * Clears everything outside the largest circle that fits, with a one-pixel
 * soft edge so the circle isn't jagged: the round icon launchers on
 * Android 7.1 show (`android:roundIcon`), which predates adaptive icons.
 */
export const maskCircle = (image: Image): Image => {
  const data = Uint8Array.from(image.data);
  const radius = Math.min(image.width, image.height) / 2;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const distance = Math.hypot(
        x + 0.5 - image.width / 2,
        y + 0.5 - image.height / 2,
      );
      const coverage = Math.min(1, Math.max(0, radius - distance + 0.5));
      const alpha = (y * image.width + x) * 4 + 3;
      data[alpha] = Math.round(data[alpha]! * coverage);
    }
  }
  return { width: image.width, height: image.height, data };
};
