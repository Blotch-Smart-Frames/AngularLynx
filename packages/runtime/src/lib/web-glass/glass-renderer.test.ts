import { describe, expect, it, vi } from 'vitest';
import { createFakeWebGL, type FakeWebGLOptions } from '../testing/fake-webgl';
import {
  GlassRenderer,
  type GlassFrame,
  type GlassShapeFrame,
} from './glass-renderer';
import { MAX_GLASS_SHAPES } from './glass-shaders';

const canvasFor = (gl: WebGLRenderingContext | null) =>
  ({ getContext: vi.fn(() => gl) }) as unknown as HTMLCanvasElement;

const image = (width: number, height: number) =>
  ({ width, height }) as HTMLCanvasElement;

const shape = (overrides: Partial<GlassShapeFrame> = {}): GlassShapeFrame => ({
  centerX: 10,
  centerY: 20,
  halfWidth: 30,
  halfHeight: 40,
  radius: 8,
  frost: 1,
  tint: [0.1, 0.2, 0.3, 0.4],
  ...overrides,
});

const frame = (overrides: Partial<GlassFrame> = {}): GlassFrame => ({
  scale: 2,
  width: 100,
  height: 50,
  offsetX: 5,
  offsetY: 6,
  smoothing: 48,
  dark: 0,
  outside: 1,
  luminance: 0.8,
  shapes: [shape()],
  ...overrides,
});

const setup = (options?: FakeWebGLOptions) => {
  const fake = createFakeWebGL(options);
  const renderer = GlassRenderer.create(canvasFor(fake.gl))!;
  fake.calls.length = 0;
  return { ...fake, renderer };
};

describe('GlassRenderer.create', () => {
  it('is null without WebGL', () => {
    expect(GlassRenderer.create(canvasFor(null))).toBeNull();
  });

  it('asks for a premultiplied context that keeps its drawing, without depth, stencil or AA', () => {
    const { gl } = createFakeWebGL();
    const canvas = canvasFor(gl);
    GlassRenderer.create(canvas);
    expect(canvas.getContext).toHaveBeenCalledWith('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // Other glass copies this canvas as a picture of what's behind it.
      preserveDrawingBuffer: true,
    });
  });

  it.each([1, 2, 3])('is null when program %i fails to link', (failing) => {
    const { gl } = createFakeWebGL({ links: (n) => n !== failing });
    expect(GlassRenderer.create(canvasFor(gl))).toBeNull();
  });

  it('binds one full-screen quad to attribute 0', () => {
    const { gl, callsTo } = createFakeWebGL();
    GlassRenderer.create(canvasFor(gl));
    expect(callsTo('bufferData')[0]![1]).toEqual(
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    );
    expect(callsTo('vertexAttribPointer')).toEqual([
      [0, 2, 'FLOAT', false, 0, 0],
    ]);
  });
});

describe('GlassRenderer', () => {
  it('reports a lost context', () => {
    expect(setup().renderer.lost).toBe(false);
    expect(setup({ lost: true }).renderer.lost).toBe(true);
  });

  it('only clears before it has a backdrop', () => {
    const { renderer, callsTo } = setup();
    renderer.draw(frame());
    expect(callsTo('clear')).toHaveLength(1);
    expect(callsTo('drawArrays')).toHaveLength(0);
  });

  it('uploads a backdrop and blurs three ever smaller copies of it', () => {
    const { renderer, callsTo } = setup();
    const backdrop = image(400, 200);
    renderer.setBackdrop(backdrop, 200, 100);

    expect(callsTo('texImage2D')).toContainEqual([
      'TEXTURE_2D',
      0,
      'RGBA',
      'RGBA',
      'UNSIGNED_BYTE',
      backdrop,
    ]);
    // The image is halved twice on the way to the frosted copy, which has a
    // pixel for every 4 CSS pixels; then the haze has one for every 8, and
    // the wash one for every 24.
    expect(callsTo('viewport')).toEqual([
      [0, 0, 200, 100],
      [0, 0, 100, 50],
      [0, 0, 50, 25],
      [0, 0, 25, 13],
      [0, 0, 8, 4],
    ]);
    // Two halving copies; a copy and three passes each way for the frost;
    // a copy and four passes each way for the haze, and again for the wash.
    expect(callsTo('drawArrays')).toHaveLength(2 + 7 + 9 + 9);
    expect(callsTo('uniform2f')).toEqual(
      expect.arrayContaining([
        [{ name: 'u_direction' }, 1 / 50, 0],
        [{ name: 'u_direction' }, 0, 1 / 25],
        [{ name: 'u_direction' }, 1 / 25, 0],
        [{ name: 'u_direction' }, 0, 1 / 13],
        [{ name: 'u_direction' }, 1 / 8, 0],
        [{ name: 'u_direction' }, 0, 1 / 4],
      ]),
    );
    expect(callsTo('bindFramebuffer').at(-1)).toEqual(['FRAMEBUFFER', null]);
  });

  it('copies straight to the frosted size when the image is within twice of it', () => {
    const { renderer, callsTo } = setup();
    // One image pixel per CSS pixel, and a backdrop 8 by 8: the frosted copy
    // is 2 by 2, so the image is halved once, to 4 by 4, and no further.
    renderer.setBackdrop(image(8, 8), 8, 8);
    expect(callsTo('viewport').slice(0, 2)).toEqual([
      [0, 0, 4, 4],
      [0, 0, 2, 2],
    ]);
  });

  it('keeps its blur targets while the backdrop size holds', () => {
    const { renderer, callsTo } = setup();
    renderer.setBackdrop(image(400, 200), 200, 100);
    renderer.setBackdrop(image(400, 200), 200, 100);
    // Two halving steps, and two targets each for the frost, haze and wash.
    expect(callsTo('createFramebuffer')).toHaveLength(8);
    expect(callsTo('createTexture')).toHaveLength(9);

    renderer.setBackdrop(image(800, 400), 400, 200);
    expect(callsTo('deleteFramebuffer')).toHaveLength(8);
    expect(callsTo('createFramebuffer')).toHaveLength(16);
  });

  it('never makes a blur target smaller than a pixel', () => {
    const { renderer, callsTo } = setup();
    renderer.setBackdrop(image(1, 1), 1, 1);
    expect(callsTo('viewport')).toEqual([
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 1],
    ]);
  });

  it('draws the glass from the frame', () => {
    const { renderer, callsTo } = setup();
    renderer.setBackdrop(image(400, 200), 200, 100);
    renderer.draw(frame());

    expect(callsTo('viewport').at(-1)).toEqual([0, 0, 200, 100]);
    expect(callsTo('uniform2f')).toEqual(
      expect.arrayContaining([
        [{ name: 'u_size' }, 100, 50],
        [{ name: 'u_offset' }, 5, 6],
        [{ name: 'u_backdropSize' }, 200, 100],
      ]),
    );
    expect(callsTo('uniform1f')).toEqual(
      expect.arrayContaining([
        [{ name: 'u_scale' }, 2],
        [{ name: 'u_smoothing' }, 48],
        [{ name: 'u_dark' }, 0],
        [{ name: 'u_outside' }, 1],
        [{ name: 'u_luminance' }, 0.8],
      ]),
    );
    // The backdrop and its three blurred copies, each on its own unit.
    expect(callsTo('uniform1i')).toEqual(
      expect.arrayContaining([
        [{ name: 'u_backdrop' }, 0],
        [{ name: 'u_frosted' }, 1],
        [{ name: 'u_haze' }, 2],
        [{ name: 'u_wash' }, 3],
        [{ name: 'u_count' }, 1],
      ]),
    );
    const arrays = Object.fromEntries(
      callsTo('uniform4fv').map(([location, values]) => [
        (location as { name: string }).name,
        Array.from(values as Float32Array).slice(0, 4),
      ]),
    );
    expect(arrays['u_bounds']).toEqual([10, 20, 30, 40]);
    expect(arrays['u_material']).toEqual([8, 1, 0, 0]);
    expect(arrays['u_tint']!.map((v) => +v.toFixed(2))).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);
    expect(callsTo('drawArrays').at(-1)).toEqual(['TRIANGLE_STRIP', 0, 4]);
  });

  it(`draws at most ${MAX_GLASS_SHAPES} shapes`, () => {
    const { renderer, callsTo } = setup();
    renderer.setBackdrop(image(4, 4), 2, 2);
    renderer.draw(
      frame({ shapes: Array.from({ length: MAX_GLASS_SHAPES + 1 }, shape) }),
    );
    expect(callsTo('uniform1i')).toContainEqual([
      { name: 'u_count' },
      MAX_GLASS_SHAPES,
    ]);
  });

  it('frees its GPU resources and context on dispose', () => {
    const { renderer, callsTo } = setup();
    renderer.setBackdrop(image(4, 4), 2, 2);
    renderer.dispose();
    // The backdrop, one halving step, and the frost, haze and wash targets.
    expect(callsTo('deleteTexture')).toHaveLength(8);
    expect(callsTo('deleteProgram')).toHaveLength(3);
    expect(callsTo('deleteBuffer')).toHaveLength(1);
    expect(callsTo('loseContext')).toHaveLength(1);
  });

  it('disposes without a backdrop or WEBGL_lose_context', () => {
    const { renderer, callsTo } = setup({ loseContext: false });
    renderer.dispose();
    expect(callsTo('deleteTexture')).toEqual([[null]]);
    expect(callsTo('loseContext')).toHaveLength(0);
  });
});
