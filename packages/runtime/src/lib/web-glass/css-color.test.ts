import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CssColor from './css-color';
import { luminance, parseNormalizedColor, TRANSPARENT } from './css-color';

/**
 * A document whose canvas context normalizes colors through `normalize`, the
 * way a browser's `fillStyle` does. jsdom has no canvas.
 */
const fakeDocument = (
  normalize: ((value: string) => string | undefined) | null,
) => {
  let fillStyle = '#000000';
  const context = normalize && {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = normalize(value) ?? fillStyle;
    },
  };
  return {
    createElement: () => ({ getContext: () => context }),
  } as unknown as Document;
};

describe('parseNormalizedColor', () => {
  it('parses the six-digit hex an opaque fillStyle reads back as', () => {
    expect(parseNormalizedColor('#ff8000')).toEqual([1, 128 / 255, 0, 1]);
  });

  it('parses comma and space separated rgb()/rgba()', () => {
    expect(parseNormalizedColor('rgb(255, 0, 0)')).toEqual([1, 0, 0, 1]);
    expect(parseNormalizedColor('rgba(0, 0, 255, 0.5)')).toEqual([
      0, 0, 1, 0.5,
    ]);
    expect(parseNormalizedColor(' rgb(0 255 0 / 0.25) ')).toEqual([
      0, 1, 0, 0.25,
    ]);
  });

  it('treats anything it cannot read as transparent', () => {
    expect(parseNormalizedColor('red')).toBe(TRANSPARENT);
    expect(parseNormalizedColor('rgb(1, 2)')).toBe(TRANSPARENT);
    expect(parseNormalizedColor('rgb(1, 2, x)')).toBe(TRANSPARENT);
  });
});

describe('resolveCssColor', () => {
  // The module keeps one canvas context and a cache, so each test gets a
  // fresh copy of it.
  let resolveCssColor: typeof CssColor.resolveCssColor;
  beforeEach(async () => {
    vi.resetModules();
    ({ resolveCssColor } = await import('./css-color'));
  });

  it('is transparent for a missing value', () => {
    expect(resolveCssColor(fakeDocument(null), null)).toEqual(TRANSPARENT);
  });

  it('is transparent without a 2D canvas context', () => {
    expect(resolveCssColor(fakeDocument(null), 'blue')).toEqual(TRANSPARENT);
  });

  it('normalizes a color through the canvas fillStyle, then caches it', () => {
    let calls = 0;
    const doc = fakeDocument((value) => {
      calls++;
      return value === 'tomato' ? 'rgba(255, 99, 71, 0.5)' : value;
    });
    expect(resolveCssColor(doc, 'tomato')).toEqual([
      1,
      99 / 255,
      71 / 255,
      0.5,
    ]);
    const before = calls;
    expect(resolveCssColor(doc, 'tomato')).toEqual([
      1,
      99 / 255,
      71 / 255,
      0.5,
    ]);
    expect(calls).toBe(before);
  });

  it('is transparent when the canvas rejects the value', () => {
    // An invalid value leaves fillStyle on the sentinel set just before it.
    const doc = fakeDocument((value) =>
      value === 'not-a-color' ? undefined : value,
    );
    expect(resolveCssColor(doc, 'not-a-color')).toEqual(TRANSPARENT);
  });
});

describe('luminance', () => {
  it('weights the channels by perceived brightness', () => {
    expect(luminance([1, 1, 1, 1])).toBeCloseTo(1);
    expect(luminance([0, 0, 0, 1])).toBe(0);
    expect(luminance([0, 1, 0, 1])).toBeCloseTo(0.7152);
  });
});
