// cspell:words IHDR IDAT
import { inflateSync } from 'node:zlib';

/**
 * Counts the pixels of each color in an 8-bit RGB or RGBA PNG, keyed
 * `"r,g,b"`. Enough for `adb shell screencap -p`'s screenshots, so the E2E
 * tests can check the colors an app draws without an image library.
 */
export const countColors = (png: Buffer): Map<string, number> => {
  if (!png.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Not a PNG');
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const chunk = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const [bitDepth, colorType, , , interlace] = chunk.subarray(8);
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
      if (bitDepth !== 8 || channels === 0 || interlace !== 0) {
        throw new Error(
          `Only 8-bit, non-interlaced RGB and RGBA PNGs are read, not bit depth ${bitDepth}, color type ${colorType}, interlace ${interlace}`,
        );
      }
    } else if (type === 'IDAT') {
      data.push(chunk);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const counts = new Map<string, number>();
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const row = Uint8Array.from(raw.subarray(start + 1, start + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      row[x] = (row[x]! + predict(filter!, left, up, upLeft)) & 0xff;
    }
    for (let x = 0; x < stride; x += channels) {
      const key = `${row[x]},${row[x + 1]},${row[x + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    previous = row;
  }
  return counts;
};

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * What a PNG row filter adds back to each byte.
 */
const predict = (filter: number, left: number, up: number, upLeft: number) => {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const p = left + up - upLeft;
      const toLeft = Math.abs(p - left);
      const toUp = Math.abs(p - up);
      const toUpLeft = Math.abs(p - upLeft);
      return toLeft <= toUp && toLeft <= toUpLeft
        ? left
        : toUp <= toUpLeft
          ? up
          : upLeft;
    }
    default:
      throw new Error(`Unknown PNG filter ${filter}`);
  }
};
