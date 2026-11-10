import { describe, expect, it } from 'vitest';

import {
  decodePng,
  encodePng,
  extendEdges,
  type Image,
  maskCircle,
  resize,
} from './png.ts';

/**
 * An image filled by `pixel(x, y)`, which returns RGBA bytes.
 */
const image = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly number[],
): Image => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
};

const at = (image: Image, x: number, y: number) => [
  ...image.data.subarray(
    (y * image.width + x) * 4,
    (y * image.width + x + 1) * 4,
  ),
];

describe('encodePng and decodePng', () => {
  it('round-trips RGBA pixels', () => {
    const original = image(3, 2, (x, y) => [x * 80, y * 200, 7, 255 - x]);
    const decoded = decodePng(encodePng(original));
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect([...decoded.data]).toEqual([...original.data]);
  });
});

describe('resize', () => {
  it('averages the pixels each output pixel covers', () => {
    // Black and white columns average to gray.
    const stripes = image(4, 4, (x) =>
      x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    const half = resize(stripes, 2, 2);
    expect(half.width).toBe(2);
    expect(half.height).toBe(2);
    expect(at(half, 0, 0)).toEqual([128, 128, 128, 255]);
    expect(at(half, 1, 1)).toEqual([128, 128, 128, 255]);
  });

  it('weights pixels an output pixel covers partly', () => {
    // 3 → 2: the first output pixel covers pixel 0 and half of pixel 1.
    const ramp = image(3, 1, (x) => [[0, 90, 180][x]!, 0, 0, 255]);
    expect(at(resize(ramp, 2, 1), 0, 0)).toEqual([30, 0, 0, 255]);
    expect(at(resize(ramp, 2, 1), 1, 0)).toEqual([150, 0, 0, 255]);
  });

  it('scales rows and columns by their own factors', () => {
    const tall = image(2, 4, (_, y) => [y < 2 ? 255 : 0, 0, 0, 255]);
    const out = resize(tall, 1, 2);
    expect(at(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(out, 0, 1)).toEqual([0, 0, 0, 255]);
  });

  it("doesn't darken an edge with transparent pixels' color", () => {
    // Transparent black next to opaque red: premultiplied, the average is
    // half-transparent red, not half-transparent dark red.
    const edge = image(2, 1, (x) => (x ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    expect(at(resize(edge, 1, 1), 0, 0)).toEqual([255, 0, 0, 128]);
    const clear = image(2, 2, () => [0, 0, 0, 0]);
    expect(at(resize(clear, 1, 1), 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('extendEdges', () => {
  it('continues each edge pixel into the margin', () => {
    const square = image(2, 2, (x, y) => [x * 100, y * 100, 0, 255]);
    const out = extendEdges(square, 2);
    expect(out.width).toBe(6);
    expect(out.height).toBe(6);
    expect(at(out, 0, 0)).toEqual(at(square, 0, 0));
    expect(at(out, 5, 0)).toEqual(at(square, 1, 0));
    expect(at(out, 5, 5)).toEqual(at(square, 1, 1));
    expect(at(out, 3, 2)).toEqual(at(square, 1, 0));
  });
});

describe('maskCircle', () => {
  it('clears the corners and keeps the middle', () => {
    const square = image(48, 48, () => [10, 20, 30, 255]);
    const round = maskCircle(square);
    expect(at(round, 0, 0)).toEqual([10, 20, 30, 0]);
    expect(at(round, 47, 47)[3]).toBe(0);
    expect(at(round, 24, 24)).toEqual([10, 20, 30, 255]);
    expect(at(round, 1, 24)).toEqual([10, 20, 30, 255]);
    // The edge is soft, not jagged.
    const edge = at(round, 0, 19)[3]!;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    // The source isn't changed.
    expect(at(square, 0, 0)[3]).toBe(255);
  });
});
