// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotBackdrop } from './backdrop-snapshot';

vi.mock('./backdrop-clone', () => ({
  cloneBackdrop: () => {
    const frame = document.createElement('div');
    frame.textContent = 'backdrop';
    return frame;
  },
  effectiveBackground: () => [0, 0, 0, 1],
}));

// jsdom neither decodes images nor draws to canvases.
let decoded: string[] = [];
class FakeImage {
  src = '';
  decode() {
    decoded.push(this.src);
    return Promise.resolve();
  }
}
const drawImage = vi.fn();

const root = (left: number, top: number, width: number, height: number) => {
  const element = document.createElement('x-view');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  } as DOMRect);
  return element;
};

const options = (
  left: number,
  top: number,
  right: number,
  bottom: number,
  scale = 2,
) => ({ exclude: () => false, region: { left, top, right, bottom }, scale });

beforeEach(() => {
  decoded = [];
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  drawImage.mockClear();
});

describe('snapshotBackdrop', () => {
  it('is null when the region misses the root', async () => {
    const element = root(0, 0, 100, 100);
    expect(await snapshotBackdrop(element, options(200, 0, 300, 50))).toBe(
      null,
    );
    expect(await snapshotBackdrop(element, options(0, 200, 50, 300))).toBe(
      null,
    );
  });

  it('rasterizes the part of the root inside the region', async () => {
    const element = root(100, 50, 400, 300);
    const snapshot = await snapshotBackdrop(element, options(150, 0, 350, 150));

    expect(snapshot).toMatchObject({ x: 50, y: 0, width: 200, height: 100 });
    expect(snapshot!.luminance).toBe(0);
    expect(snapshot!.image.width).toBe(400);
    expect(snapshot!.image.height).toBe(200);
    expect(drawImage).toHaveBeenCalledWith(
      expect.any(FakeImage),
      0,
      0,
      400,
      200,
    );

    const svg = decodeURIComponent(decoded[0]!.split(',')[1]!);
    // The viewBox crops the whole root down to the region.
    expect(svg).toContain('width="400" height="200" viewBox="50 0 200 100"');
    expect(svg).toContain('<foreignObject width="400" height="300">');
    expect(svg).toContain('backdrop');
  });

  it('keeps the image inside the texture size limit', async () => {
    const element = root(0, 0, 8192, 100);
    const snapshot = await snapshotBackdrop(element, options(0, 0, 8192, 100));
    expect(snapshot!.image.width).toBe(4096);
  });

  it('never makes an image smaller than a pixel', async () => {
    const element = root(0, 0, 100, 100);
    const snapshot = await snapshotBackdrop(
      element,
      options(0, 0, 0.1, 0.1, 1),
    );
    expect(snapshot!.image.width).toBe(1);
    expect(snapshot!.image.height).toBe(1);
  });
});
