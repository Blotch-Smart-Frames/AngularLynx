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
  shadow: 1,
  shapes: [shape()],
  pointer: [1, 2, 0.5],
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

  it('asks for a premultiplied context without depth, stencil or AA', () => {
    const { gl } = createFakeWebGL();
    const canvas = canvasFor(gl);
    GlassRenderer.create(canvas);
    expect(canvas.getContext).toHaveBeenCalledWith('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
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

  it('uploads a backdrop and blurs a quarter-size copy of it', () => {
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
    expect(callsTo('viewport')).toEqual([[0, 0, 100, 50]]);
    // One downsampling copy, then three horizontal and vertical blur passes.
    expect(callsTo('drawArrays')).toHaveLength(7);
    expect(callsTo('uniform2f')).toEqual(
      expect.arrayContaining([
        [{ name: 'u_direction' }, 1 / 100, 0],
        [{ name: 'u_direction' }, 0, 1 / 50],
      ]),
    );
    expect(callsTo('bindFramebuffer').at(-1)).toEqual(['FRAMEBUFFER', null]);
  });

  it('keeps its blur targets while the backdrop size holds', () => {
    const { renderer, callsTo } = setup();
    renderer.setBackdrop(image(400, 200), 200, 100);
    renderer.setBackdrop(image(400, 200), 200, 100);
    expect(callsTo('createFramebuffer')).toHaveLength(2);
    expect(callsTo('createTexture')).toHaveLength(3);

    renderer.setBackdrop(image(800, 400), 400, 200);
    expect(callsTo('deleteFramebuffer')).toHaveLength(2);
    expect(callsTo('createFramebuffer')).toHaveLength(4);
  });

  it('never makes a blur target smaller than a pixel', () => {
    const { renderer, callsTo } = setup();
    renderer.setBackdrop(image(1, 1), 1, 1);
    expect(callsTo('viewport')).toEqual([[0, 0, 1, 1]]);
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
        [{ name: 'u_shadow' }, 1],
      ]),
    );
    expect(callsTo('uniform3f')).toEqual([[{ name: 'u_pointer' }, 1, 2, 0.5]]);
    expect(callsTo('uniform1i')).toContainEqual([{ name: 'u_count' }, 1]);
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
    expect(callsTo('deleteTexture')).toHaveLength(3);
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
