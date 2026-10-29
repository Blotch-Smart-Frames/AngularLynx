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
    // The copy is moved and scaled to fill the image with the region:
    // Safari ignores a viewBox for a <foreignObject>'s content.
    expect(svg).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">' +
        '<foreignObject width="400" height="200">',
    );
    expect(svg).toContain(
      'transform-origin: 0 0; transform: scale(2,2) translate(-50px,0px);',
    );
    expect(svg).toContain('backdrop');
  });

  it('crops in CSS pixels when the page is drawn scaled', async () => {
    // Laid out 800 CSS pixels wide, drawn 400 wide.
    const element = root(100, 50, 400, 300);
    vi.spyOn(element, 'offsetWidth', 'get').mockReturnValue(800);
    const snapshot = await snapshotBackdrop(element, options(150, 0, 350, 150));

    expect(snapshot).toMatchObject({ x: 100, y: 0, width: 400, height: 200 });
    expect(snapshot!.image.width).toBe(800);
    const svg = decodeURIComponent(decoded[0]!.split(',')[1]!);
    expect(svg).toContain('<foreignObject width="800" height="400">');
    expect(svg).toContain('transform: scale(2,2) translate(-100px,0px);');
  });

  it('fills the image to its edges', async () => {
    const element = root(0, 0, 360, 356.47);
    await snapshotBackdrop(element, options(0, 0, 360, 356.47, 1.36));
    const svg = decodeURIComponent(decoded[0]!.split(',')[1]!);
    // 360 × 1.36 and 356.47 × 1.36 round to 490 and 485 pixels, a shape a
    // little off the region's, so the copy is stretched to fit.
    expect(svg).toContain('<foreignObject width="490" height="485">');
    expect(svg).toContain(
      `scale(${490 / 360},${485 / 356.47}) translate(0px,0px)`,
    );
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
