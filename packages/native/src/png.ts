import { closeSync, openSync, readSync } from 'node:fs';

import { PNG } from 'pngjs';

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
  const png = PNG.sync.read(bytes);
  return { width: png.width, height: png.height, data: png.data };
};

export const encodePng = (image: Image): Buffer =>
  PNG.sync.write(
    Object.assign(new PNG({ width: image.width, height: image.height }), {
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
  const premultiplied = new Float32Array(image.width * image.height * 4);
  for (let i = 0; i < image.width * image.height; i++) {
    const alpha = image.data[i * 4 + 3]! / 255;
    premultiplied[i * 4] = image.data[i * 4]! * alpha;
    premultiplied[i * 4 + 1] = image.data[i * 4 + 1]! * alpha;
    premultiplied[i * 4 + 2] = image.data[i * 4 + 2]! * alpha;
    premultiplied[i * 4 + 3] = alpha;
  }
  // Separable: rows first, then columns, which is the same average as
  // over each output pixel's rectangle, at a fraction of the work.
  const rows = resizeAxis(
    premultiplied,
    image.width,
    width,
    image.height,
    true,
  );
  const both = resizeAxis(rows, image.height, height, width, false);

  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const alpha = both[i * 4 + 3]!;
    const unpremultiply = alpha > 0 ? 1 / alpha : 0;
    data[i * 4] = toByte(both[i * 4]! * unpremultiply);
    data[i * 4 + 1] = toByte(both[i * 4 + 1]! * unpremultiply);
    data[i * 4 + 2] = toByte(both[i * 4 + 2]! * unpremultiply);
    data[i * 4 + 3] = toByte(alpha * 255);
  }
  return { width, height, data };
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
  // Which source pixels each output pixel covers, and by how much.
  const spans = Array.from({ length: to }, (_, i) => {
    const start = i * scale;
    const end = start + scale;
    const taps: { index: number; weight: number }[] = [];
    for (let j = Math.floor(start); j < Math.min(Math.ceil(end), from); j++) {
      taps.push({
        index: j,
        weight: (Math.min(end, j + 1) - Math.max(start, j)) / scale,
      });
    }
    return taps;
  });
  const offset = (line: number, i: number, length: number) =>
    (horizontal ? line * length + i : i * lines + line) * 4;

  const out = new Float32Array(to * lines * 4);
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < to; i++) {
      const target = offset(line, i, to);
      for (const { index, weight } of spans[i]!) {
        const source = offset(line, index, from);
        for (let channel = 0; channel < 4; channel++) {
          out[target + channel]! += pixels[source + channel]! * weight;
        }
      }
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
