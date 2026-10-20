import { describe, expect, it } from 'vitest';
import { createFakeWebGL } from '../testing/fake-webgl';
import { compile, createTarget, createTexture } from './glass-gl';
import { QUAD_VERTEX_SHADER } from './glass-shaders';

describe('compile', () => {
  it('links the quad vertex shader with the fragment shader', () => {
    const { gl, callsTo } = createFakeWebGL();
    const program = compile(gl, 'fragment source');

    expect(program).not.toBeNull();
    expect(callsTo('shaderSource').map(([, source]) => source)).toEqual([
      QUAD_VERTEX_SHADER,
      'fragment source',
    ]);
    // The shared quad buffer feeds attribute 0 of every program.
    expect(callsTo('bindAttribLocation')).toEqual([
      [program!.program, 0, 'a_position'],
    ]);
  });

  it('is null when the program does not link', () => {
    const { gl } = createFakeWebGL({ links: () => false });
    expect(compile(gl, 'broken')).toBeNull();
  });

  it('looks each uniform up once', () => {
    const { gl, callsTo } = createFakeWebGL();
    const { uniform } = compile(gl, 'fragment')!;
    expect(uniform('u_size')).toEqual({ name: 'u_size' });
    expect(uniform('u_size')).toEqual({ name: 'u_size' });
    expect(callsTo('getUniformLocation')).toHaveLength(1);
  });
});

describe('createTexture', () => {
  it('filters linearly and clamps both axes', () => {
    const { gl, callsTo } = createFakeWebGL();
    createTexture(gl);
    expect(callsTo('texParameteri')).toEqual([
      ['TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'LINEAR'],
      ['TEXTURE_2D', 'TEXTURE_MAG_FILTER', 'LINEAR'],
      ['TEXTURE_2D', 'TEXTURE_WRAP_S', 'CLAMP_TO_EDGE'],
      ['TEXTURE_2D', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE'],
    ]);
  });
});

describe('createTarget', () => {
  it('attaches an empty texture of the given size to a framebuffer', () => {
    const { gl, callsTo } = createFakeWebGL();
    const target = createTarget(gl, 32, 16);
    expect(callsTo('texImage2D')).toEqual([
      ['TEXTURE_2D', 0, 'RGBA', 32, 16, 0, 'RGBA', 'UNSIGNED_BYTE', null],
    ]);
    expect(callsTo('framebufferTexture2D')).toEqual([
      ['FRAMEBUFFER', 'COLOR_ATTACHMENT0', 'TEXTURE_2D', target.texture, 0],
    ]);
  });
});
