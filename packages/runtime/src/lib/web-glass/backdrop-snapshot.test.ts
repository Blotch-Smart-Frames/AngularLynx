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

  it('crops in CSS pixels when the page is drawn scaled', async () => {
    // Laid out 800 CSS pixels wide, drawn 400 wide.
    const element = root(100, 50, 400, 300);
    vi.spyOn(element, 'offsetWidth', 'get').mockReturnValue(800);
    const snapshot = await snapshotBackdrop(element, options(150, 0, 350, 150));

    expect(snapshot).toMatchObject({ x: 100, y: 0, width: 400, height: 200 });
    expect(snapshot!.image.width).toBe(800);
    const svg = decodeURIComponent(decoded[0]!.split(',')[1]!);
    expect(svg).toContain('width="800" height="400" viewBox="100 0 400 200"');
    expect(svg).toContain('<foreignObject width="800" height="600">');
  });

  it('fills the image to its edges', async () => {
    const element = root(0, 0, 360, 356.47);
    await snapshotBackdrop(element, options(0, 0, 360, 356.47, 1.36));
    const svg = decodeURIComponent(decoded[0]!.split(',')[1]!);
    // 360 × 1.36 and 356.47 × 1.36 round to 490 and 485 pixels, a shape a
    // little off the viewBox's, so the viewBox is stretched to fit.
    expect(svg).toContain(
      'width="490" height="485" viewBox="0 0 360 356.47" ' +
        'preserveAspectRatio="none"',
    );
    // As big as the copy's frame, which is rounded up to whole pixels.
    expect(svg).toContain('<foreignObject width="360" height="357">');
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
