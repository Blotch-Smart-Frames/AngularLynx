import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeWebGLBridge,
  type FakeWebGLBridge,
} from '../testing/fake-webgl-bridge';
import { NATIVE_IMAGE } from './native-image';
import { WEBGL2_CONSTANTS as GL } from './webgl-constants';
import { OP } from './webgl-ops';
import {
  contextAttributesFrom,
  LynxWebGL2RenderingContext,
  pixelSize,
  type WebGLCanvasHost,
} from './webgl2-context';
import type {
  LynxWebGLProgram,
  LynxWebGLShader,
  LynxWebGLUniformLocation,
} from './webgl-objects';

const words = (bytes: number[]): number[] => {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  return [...new Uint32Array(padded.buffer), bytes.length];
};

let bridge: FakeWebGLBridge;
let canvas: WebGLCanvasHost & {
  dispatchContextEvent: ReturnType<typeof vi.fn>;
};
let gl: LynxWebGL2RenderingContext;

const makeContext = (): LynxWebGL2RenderingContext =>
  new LynxWebGL2RenderingContext(
    bridge,
    7,
    canvas,
    contextAttributesFrom(undefined),
  );

/**
 * Sends what's recorded, as the end of the task does, and returns it.
 */
const flushed = async (): Promise<unknown[]> => {
  const from = bridge.batches.length;
  await Promise.resolve();
  return bridge.batches.slice(from).flat();
};

/**
 * What one call sends, without its end-of-task present.
 */
const sends = async (call: () => void): Promise<unknown[]> => {
  call();
  return (await flushed()).filter((item, i, all) =>
    i === all.length - 1 ? item !== OP.present : true,
  );
};

const program = (info: Record<string, unknown> = {}) => {
  const p = gl.createProgram();
  gl.linkProgram(p);
  bridge.answers.push({
    linked: 1,
    log: '',
    uniforms: [
      ['color', 1, GL.FLOAT_VEC4, 3],
      ['lights[0]', 4, GL.FLOAT_VEC3, 5],
    ],
    attributes: [['position', 1, GL.FLOAT_VEC3, 0]],
    uniformBlocks: 1,
    transformFeedbackVaryings: 2,
    ...info,
  });
  gl.getProgramParameter(p, GL.LINK_STATUS);
  return p;
};

beforeEach(() => {
  bridge = createFakeWebGLBridge();
  canvas = { width: 300, height: 150, dispatchContextEvent: vi.fn(() => true) };
  gl = makeContext();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a new context', () => {
  it('makes the drawing buffer and fetches what never changes, in one call', () => {
    expect(bridge.batches).toHaveLength(1);
    const [first] = bridge.batches;
    expect(first.slice(0, 3)).toEqual([OP.resize, 300, 150]);
    expect(first).toContain(OP.getSupportedExtensions);
    expect(first.at(-1)).toBe(OP.getError);
    // MAX_CLIENT_WAIT_TIMEOUT_WEBGL is WebGL's, which GLES doesn't know.
    expect(first).not.toContain(GL.MAX_CLIENT_WAIT_TIMEOUT_WEBGL);
    expect(gl.drawingBufferWidth).toBe(300);
    expect(gl.drawingBufferHeight).toBe(150);
  });

  it('answers the limits and precisions without asking again', () => {
    bridge.limits.set(GL.MAX_TEXTURE_SIZE, 8192);
    bridge.limits.set(GL.MAX_VIEWPORT_DIMS, [16384, 16384]);
    gl = makeContext();
    const before = bridge.batches.length;
    expect(gl.getParameter(GL.MAX_TEXTURE_SIZE)).toBe(8192);
    const dims = gl.getParameter(GL.MAX_VIEWPORT_DIMS) as Int32Array;
    expect(dims).toEqual(new Int32Array([16384, 16384]));
    // A copy, so changing it changes nothing.
    dims[0] = 1;
    expect(gl.getParameter(GL.MAX_VIEWPORT_DIMS)).toEqual(
      new Int32Array([16384, 16384]),
    );
    expect(gl.getParameter(GL.MAX_CLIENT_WAIT_TIMEOUT_WEBGL)).toBe(0);
    const format = gl.getShaderPrecisionFormat(
      GL.FRAGMENT_SHADER,
      GL.HIGH_FLOAT,
    );
    expect(format).toMatchObject({
      rangeMin: 127,
      rangeMax: 127,
      precision: 23,
    });
    expect(gl.getShaderPrecisionFormat(0, 0)).toBeNull();
    expect(bridge.batches).toHaveLength(before);
  });

  it('turns the GL extensions into WebGL ones', () => {
    expect(gl.getSupportedExtensions()).toEqual([
      'EXT_color_buffer_float',
      'EXT_color_buffer_half_float',
      'EXT_texture_filter_anisotropic',
      'WEBGL_compressed_texture_astc',
      'WEBGL_compressed_texture_etc',
      'WEBGL_debug_renderer_info',
      'WEBGL_lose_context',
    ]);
  });

  it('copes with a driver that answers nothing', () => {
    bridge.run = (_id, commands) => {
      bridge.batches.push(commands);
      return [];
    };
    gl = makeContext();
    expect(
      gl.getShaderPrecisionFormat(GL.VERTEX_SHADER, GL.LOW_INT),
    ).toMatchObject({ rangeMin: 0, rangeMax: 0, precision: 0 });
    expect(gl.getSupportedExtensions()).toEqual([
      'WEBGL_compressed_texture_etc',
      'WEBGL_debug_renderer_info',
      'WEBGL_lose_context',
    ]);
    expect(gl.getParameter(GL.MAX_TEXTURE_SIZE)).toBeNull();
  });

  it('has the constants on the context and its class', () => {
    expect(gl.TEXTURE_2D).toBe(0x0de1);
    expect(LynxWebGL2RenderingContext.prototype.RGBA).toBe(0x1908);
    expect((LynxWebGL2RenderingContext as unknown as typeof GL).FLOAT).toBe(
      0x1406,
    );
  });

  it('fills in WebGL’s default attributes', () => {
    expect(contextAttributesFrom({ alpha: false, antialias: false })).toEqual({
      alpha: false,
      antialias: false,
      depth: true,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'default',
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: false,
    });
    expect(
      contextAttributesFrom({
        depth: false,
        failIfMajorPerformanceCaveat: true,
        powerPreference: 'low-power',
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        stencil: true,
      }),
    ).toMatchObject({
      depth: false,
      failIfMajorPerformanceCaveat: true,
      powerPreference: 'low-power',
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      stencil: true,
    });
    expect(gl.getContextAttributes()).toMatchObject({ alpha: true });
  });
});

describe('batching', () => {
  it('sends the calls at the end of the task, and presents what drew', async () => {
    gl.clearColor(1, 0, 0, 1);
    gl.clear(GL.COLOR_BUFFER_BIT);
    expect(bridge.batches).toHaveLength(1);
    expect(await flushed()).toEqual([
      OP.clearColor,
      1,
      0,
      0,
      1,
      OP.clear,
      GL.COLOR_BUFFER_BIT,
      OP.present,
    ]);
  });

  it('doesn’t present what drew to a framebuffer', async () => {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    expect(await flushed()).not.toContain(OP.present);
    gl.bindFramebuffer(GL.FRAMEBUFFER, null);
    gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, framebuffer);
    gl.clear(GL.COLOR_BUFFER_BIT);
    expect(await flushed()).not.toContain(OP.present);
    expect(gl.getParameter(GL.FRAMEBUFFER_BINDING)).toBe(framebuffer);
    expect(gl.getParameter(GL.READ_FRAMEBUFFER_BINDING)).toBeNull();
  });

  it('sends nothing when nothing was recorded', async () => {
    expect(await flushed()).toEqual([]);
  });

  it('sends a long batch before it grows further', () => {
    for (let i = 0; i < 33000; i++) gl.enable(GL.BLEND);
    expect(bridge.batches).toHaveLength(2);
    expect(bridge.batches[1]).toHaveLength(65538);
  });

  it('sends what’s recorded before a question', () => {
    gl.enable(GL.DEPTH_TEST);
    bridge.answers.push(1);
    expect(gl.isEnabled(GL.DEPTH_TEST)).toBe(true);
    expect(bridge.batches.at(-1)).toEqual([
      OP.enable,
      GL.DEPTH_TEST,
      OP.isEnabled,
      GL.DEPTH_TEST,
    ]);
  });

  it('sends at once on flush() and finish()', () => {
    gl.flush();
    expect(bridge.batches.at(-1)).toEqual([OP.flush]);
    gl.finish();
    expect(bridge.batches.at(-1)).toEqual([OP.finish]);
  });
});

describe('the commands', () => {
  const buffer = () => gl.createBuffer();
  it.each([
    ['activeTexture', [GL.TEXTURE1], [OP.activeTexture, GL.TEXTURE1]],
    ['blendColor', [1, 2, 3, 4], [OP.blendColor, 1, 2, 3, 4]],
    ['blendEquation', [GL.FUNC_ADD], [OP.blendEquation, GL.FUNC_ADD]],
    ['blendEquationSeparate', [1, 2], [OP.blendEquationSeparate, 1, 2]],
    ['blendFunc', [1, 2], [OP.blendFunc, 1, 2]],
    ['blendFuncSeparate', [1, 2, 3, 4], [OP.blendFuncSeparate, 1, 2, 3, 4]],
    ['clearDepth', [1], [OP.clearDepth, 1]],
    ['clearStencil', [2], [OP.clearStencil, 2]],
    ['colorMask', [true, false, true, false], [OP.colorMask, 1, 0, 1, 0]],
    ['cullFace', [GL.BACK], [OP.cullFace, GL.BACK]],
    ['depthFunc', [GL.LESS], [OP.depthFunc, GL.LESS]],
    ['depthMask', [false], [OP.depthMask, 0]],
    ['depthRange', [0, 1], [OP.depthRange, 0, 1]],
    ['disable', [GL.BLEND], [OP.disable, GL.BLEND]],
    ['frontFace', [GL.CW], [OP.frontFace, GL.CW]],
    ['hint', [1, 2], [OP.hint, 1, 2]],
    ['lineWidth', [2], [OP.lineWidth, 2]],
    ['polygonOffset', [1, 2], [OP.polygonOffset, 1, 2]],
    ['sampleCoverage', [0.5, true], [OP.sampleCoverage, 0.5, 1]],
    ['scissor', [1, 2, 3, 4], [OP.scissor, 1, 2, 3, 4]],
    ['stencilFunc', [1, 2, -1], [OP.stencilFunc, 1, 2, 0xffffffff]],
    [
      'stencilFuncSeparate',
      [1, 2, 3, -1],
      [OP.stencilFuncSeparate, 1, 2, 3, 0xffffffff],
    ],
    ['stencilMask', [-1], [OP.stencilMask, 0xffffffff]],
    ['stencilMaskSeparate', [1, -1], [OP.stencilMaskSeparate, 1, 0xffffffff]],
    ['stencilOp', [1, 2, 3], [OP.stencilOp, 1, 2, 3]],
    ['stencilOpSeparate', [1, 2, 3, 4], [OP.stencilOpSeparate, 1, 2, 3, 4]],
    ['viewport', [1, 2, 3, 4], [OP.viewport, 1, 2, 3, 4]],
    ['enableVertexAttribArray', [1], [OP.enableVertexAttribArray, 1]],
    ['disableVertexAttribArray', [1], [OP.disableVertexAttribArray, 1]],
    [
      'vertexAttribPointer',
      [1, 3, GL.FLOAT, true, 12, 4],
      [OP.vertexAttribPointer, 1, 3, GL.FLOAT, 1, 12, 4],
    ],
    [
      'vertexAttribIPointer',
      [1, 3, GL.INT, 12, 4],
      [OP.vertexAttribIPointer, 1, 3, GL.INT, 12, 4],
    ],
    ['vertexAttribDivisor', [1, 2], [OP.vertexAttribDivisor, 1, 2]],
    ['vertexAttrib1f', [1, 5], [OP.vertexAttrib4f, 1, 5, 0, 0, 1]],
    ['vertexAttrib2f', [1, 5, 6], [OP.vertexAttrib4f, 1, 5, 6, 0, 1]],
    ['vertexAttrib3f', [1, 5, 6, 7], [OP.vertexAttrib4f, 1, 5, 6, 7, 1]],
    ['vertexAttrib4f', [1, 5, 6, 7, 8], [OP.vertexAttrib4f, 1, 5, 6, 7, 8]],
    ['vertexAttrib1fv', [1, [5]], [OP.vertexAttrib4f, 1, 5, 0, 0, 1]],
    ['vertexAttrib2fv', [1, [5, 6]], [OP.vertexAttrib4f, 1, 5, 6, 0, 1]],
    ['vertexAttrib3fv', [1, [5, 6, 7]], [OP.vertexAttrib4f, 1, 5, 6, 7, 1]],
    ['vertexAttrib4fv', [1, [5, 6, 7, 8]], [OP.vertexAttrib4f, 1, 5, 6, 7, 8]],
    ['vertexAttribI4i', [1, 5, 6, 7, 8], [OP.vertexAttribI4i, 1, 5, 6, 7, 8]],
    [
      'vertexAttribI4iv',
      [1, [5, 6, 7, 8]],
      [OP.vertexAttribI4i, 1, 5, 6, 7, 8],
    ],
    ['vertexAttribI4ui', [1, 5, 6, 7, 8], [OP.vertexAttribI4ui, 1, 5, 6, 7, 8]],
    [
      'vertexAttribI4uiv',
      [1, [5, 6, 7, 8]],
      [OP.vertexAttribI4ui, 1, 5, 6, 7, 8],
    ],
    ['clear', [GL.DEPTH_BUFFER_BIT], [OP.clear, GL.DEPTH_BUFFER_BIT]],
    [
      'clearBufferfv',
      [GL.COLOR, 0, new Float32Array([1, 2, 3, 4])],
      [OP.clearBufferfv, GL.COLOR, 0, [1, 2, 3, 4]],
    ],
    [
      'clearBufferiv',
      [GL.COLOR, 0, [1, 2, 3, 4], 1],
      [OP.clearBufferiv, GL.COLOR, 0, [2, 3, 4]],
    ],
    [
      'clearBufferuiv',
      [GL.COLOR, 0, new Uint32Array([1, 2, 3, 4])],
      [OP.clearBufferuiv, GL.COLOR, 0, [1, 2, 3, 4]],
    ],
    [
      'clearBufferfi',
      [GL.DEPTH_STENCIL, 0, 1, 0],
      [OP.clearBufferfi, GL.DEPTH_STENCIL, 0, 1, 0],
    ],
    ['drawArrays', [GL.TRIANGLES, 0, 3], [OP.drawArrays, GL.TRIANGLES, 0, 3]],
    [
      'drawArraysInstanced',
      [GL.TRIANGLES, 0, 3, 2],
      [OP.drawArraysInstanced, GL.TRIANGLES, 0, 3, 2],
    ],
    [
      'drawElements',
      [GL.TRIANGLES, 6, GL.UNSIGNED_SHORT, 0],
      [OP.drawElements, GL.TRIANGLES, 6, GL.UNSIGNED_SHORT, 0],
    ],
    [
      'drawElementsInstanced',
      [GL.TRIANGLES, 6, GL.UNSIGNED_SHORT, 0, 2],
      [OP.drawElementsInstanced, GL.TRIANGLES, 6, GL.UNSIGNED_SHORT, 0, 2],
    ],
    [
      'drawRangeElements',
      [GL.TRIANGLES, 0, 3, 6, GL.UNSIGNED_SHORT, 0],
      [OP.drawRangeElements, GL.TRIANGLES, 0, 3, 6, GL.UNSIGNED_SHORT, 0],
    ],
    ['drawBuffers', [[GL.BACK]], [OP.drawBuffers, [GL.BACK]]],
    ['readBuffer', [GL.BACK], [OP.readBuffer, GL.BACK]],
    [
      'blitFramebuffer',
      [0, 0, 1, 1, 0, 0, 2, 2, GL.COLOR_BUFFER_BIT, GL.LINEAR],
      [
        OP.blitFramebuffer,
        0,
        0,
        1,
        1,
        0,
        0,
        2,
        2,
        GL.COLOR_BUFFER_BIT,
        GL.LINEAR,
      ],
    ],
    [
      'invalidateFramebuffer',
      [GL.FRAMEBUFFER, [GL.COLOR]],
      [OP.invalidateFramebuffer, GL.FRAMEBUFFER, [GL.COLOR]],
    ],
    [
      'invalidateSubFramebuffer',
      [GL.FRAMEBUFFER, [GL.COLOR], 1, 2, 3, 4],
      [OP.invalidateSubFramebuffer, GL.FRAMEBUFFER, [GL.COLOR], 1, 2, 3, 4],
    ],
    [
      'renderbufferStorage',
      [GL.RENDERBUFFER, GL.RGBA8, 1, 2],
      [OP.renderbufferStorage, GL.RENDERBUFFER, GL.RGBA8, 1, 2],
    ],
    [
      'renderbufferStorageMultisample',
      [GL.RENDERBUFFER, 4, GL.RGBA8, 1, 2],
      [OP.renderbufferStorageMultisample, GL.RENDERBUFFER, 4, GL.RGBA8, 1, 2],
    ],
    [
      'texParameterf',
      [GL.TEXTURE_2D, 1, 2],
      [OP.texParameterf, GL.TEXTURE_2D, 1, 2],
    ],
    [
      'texParameteri',
      [GL.TEXTURE_2D, 1, 2],
      [OP.texParameteri, GL.TEXTURE_2D, 1, 2],
    ],
    [
      'texStorage2D',
      [GL.TEXTURE_2D, 1, GL.RGBA8, 4, 4],
      [OP.texStorage2D, GL.TEXTURE_2D, 1, GL.RGBA8, 4, 4],
    ],
    [
      'texStorage3D',
      [GL.TEXTURE_3D, 1, GL.RGBA8, 4, 4, 4],
      [OP.texStorage3D, GL.TEXTURE_3D, 1, GL.RGBA8, 4, 4, 4],
    ],
    ['generateMipmap', [GL.TEXTURE_2D], [OP.generateMipmap, GL.TEXTURE_2D]],
    [
      'copyTexImage2D',
      [GL.TEXTURE_2D, 0, GL.RGBA, 0, 0, 4, 4, 0],
      [OP.copyTexImage2D, GL.TEXTURE_2D, 0, GL.RGBA, 0, 0, 4, 4, 0],
    ],
    [
      'copyTexSubImage2D',
      [GL.TEXTURE_2D, 0, 1, 2, 0, 0, 4, 4],
      [OP.copyTexSubImage2D, GL.TEXTURE_2D, 0, 1, 2, 0, 0, 4, 4],
    ],
    [
      'copyTexSubImage3D',
      [GL.TEXTURE_3D, 0, 1, 2, 3, 0, 0, 4, 4],
      [OP.copyTexSubImage3D, GL.TEXTURE_3D, 0, 1, 2, 3, 0, 0, 4, 4],
    ],
    [
      'copyBufferSubData',
      [GL.COPY_READ_BUFFER, GL.COPY_WRITE_BUFFER, 1, 2, 3],
      [
        OP.copyBufferSubData,
        GL.COPY_READ_BUFFER,
        GL.COPY_WRITE_BUFFER,
        1,
        2,
        3,
      ],
    ],
    ['endQuery', [GL.ANY_SAMPLES_PASSED], [OP.endQuery, GL.ANY_SAMPLES_PASSED]],
    [
      'beginTransformFeedback',
      [GL.POINTS],
      [OP.beginTransformFeedback, GL.POINTS],
    ],
    ['endTransformFeedback', [], [OP.endTransformFeedback]],
    ['pauseTransformFeedback', [], [OP.pauseTransformFeedback]],
    ['resumeTransformFeedback', [], [OP.resumeTransformFeedback]],
    [
      'readPixels',
      [0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, 64],
      [OP.readPixelsToBuffer, 0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, 64],
    ],
  ] as [keyof LynxWebGL2RenderingContext, unknown[], unknown[]][])(
    '%s',
    async (method, args, expected) => {
      expect(
        await sends(() => (gl[method] as (...a: unknown[]) => void)(...args)),
      ).toEqual(expected);
    },
  );

  it('sends objects by id, and null as 0', async () => {
    const b = buffer();
    expect(
      await sends(() => {
        gl.bindBuffer(GL.ARRAY_BUFFER, b);
        gl.bindBuffer(GL.ARRAY_BUFFER, null);
      }),
    ).toEqual([
      OP.createBuffer,
      b.id,
      OP.bindBuffer,
      GL.ARRAY_BUFFER,
      b.id,
      OP.bindBuffer,
      GL.ARRAY_BUFFER,
      0,
    ]);
  });

  it('refuses another context’s object', () => {
    const other = makeContext();
    gl.bindBuffer(GL.ARRAY_BUFFER, other.createBuffer());
    expect(gl.getError()).toBe(GL.INVALID_OPERATION);
  });

  it('asks the driver for errors once its own are reported', () => {
    gl.createShader(0);
    gl.createShader(1);
    expect(gl.getError()).toBe(GL.INVALID_ENUM);
    bridge.answers.push(GL.OUT_OF_MEMORY);
    expect(gl.getError()).toBe(GL.OUT_OF_MEMORY);
    expect(gl.getError()).toBe(GL.NO_ERROR);
  });
});

describe('objects', () => {
  it.each([
    ['Buffer', OP.createBuffer, OP.deleteBuffer, 'isBuffer'],
    [
      'Framebuffer',
      OP.createFramebuffer,
      OP.deleteFramebuffer,
      'isFramebuffer',
    ],
    ['Program', OP.createProgram, OP.deleteProgram, 'isProgram'],
    ['Query', OP.createQuery, OP.deleteQuery, 'isQuery'],
    [
      'Renderbuffer',
      OP.createRenderbuffer,
      OP.deleteRenderbuffer,
      'isRenderbuffer',
    ],
    ['Sampler', OP.createSampler, OP.deleteSampler, 'isSampler'],
    ['Texture', OP.createTexture, OP.deleteTexture, 'isTexture'],
    [
      'TransformFeedback',
      OP.createTransformFeedback,
      OP.deleteTransformFeedback,
      'isTransformFeedback',
    ],
    [
      'VertexArray',
      OP.createVertexArray,
      OP.deleteVertexArray,
      'isVertexArray',
    ],
  ] as const)(
    '%s: made and deleted by id, once',
    async (kind, create, remove, is) => {
      const call = gl as unknown as Record<string, (...args: unknown[]) => any>;
      const object = call[`create${kind}`]();
      expect(call[is](object)).toBe(true);
      call[`delete${kind}`](object);
      call[`delete${kind}`](object);
      call[`delete${kind}`](null);
      expect(call[is](object)).toBe(false);
      expect(call[is](null)).toBe(false);
      expect(await flushed()).toEqual([create, object.id, remove, object.id]);
    },
  );

  it('makes shaders of a type, and refuses others', async () => {
    const shader = gl.createShader(GL.VERTEX_SHADER)!;
    expect(gl.isShader(shader)).toBe(true);
    gl.deleteShader(shader);
    gl.deleteShader(shader);
    expect(gl.isShader(shader)).toBe(false);
    expect(await flushed()).toEqual([
      OP.createShader,
      shader.id,
      GL.VERTEX_SHADER,
      OP.deleteShader,
      shader.id,
    ]);
  });

  it('makes and deletes syncs', async () => {
    const sync = gl.fenceSync(GL.SYNC_GPU_COMMANDS_COMPLETE, 0);
    expect(gl.isSync(sync)).toBe(true);
    gl.waitSync(sync, 0, -1);
    gl.deleteSync(sync);
    gl.deleteSync(sync);
    expect(gl.isSync(sync)).toBe(false);
    expect(await flushed()).toEqual([
      OP.fenceSync,
      sync.id,
      GL.SYNC_GPU_COMMANDS_COMPLETE,
      0,
      OP.waitSync,
      sync.id,
      0,
      -1,
      OP.deleteSync,
      sync.id,
    ]);
  });

  it('unbinds what it deletes', () => {
    const b = gl.createBuffer();
    for (const target of [
      GL.ARRAY_BUFFER,
      GL.ELEMENT_ARRAY_BUFFER,
      GL.COPY_READ_BUFFER,
      GL.COPY_WRITE_BUFFER,
      GL.PIXEL_PACK_BUFFER,
      GL.PIXEL_UNPACK_BUFFER,
      GL.UNIFORM_BUFFER,
      GL.TRANSFORM_FEEDBACK_BUFFER,
    ]) {
      gl.bindBuffer(target, b);
    }
    const kept = gl.createBuffer();
    gl.deleteBuffer(kept);
    expect(gl.getParameter(GL.ARRAY_BUFFER_BINDING)).toBe(b);
    gl.deleteBuffer(b);
    for (const pname of [
      GL.ARRAY_BUFFER_BINDING,
      GL.ELEMENT_ARRAY_BUFFER_BINDING,
      GL.COPY_READ_BUFFER_BINDING,
      GL.COPY_WRITE_BUFFER_BINDING,
      GL.PIXEL_PACK_BUFFER_BINDING,
      GL.PIXEL_UNPACK_BUFFER_BINDING,
      GL.UNIFORM_BUFFER_BINDING,
      GL.TRANSFORM_FEEDBACK_BUFFER_BINDING,
    ]) {
      expect(gl.getParameter(pname)).toBeNull();
    }

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    gl.deleteFramebuffer(framebuffer);
    expect(gl.getParameter(GL.FRAMEBUFFER_BINDING)).toBeNull();
    expect(gl.getParameter(GL.READ_FRAMEBUFFER_BINDING)).toBeNull();
    const other = gl.createFramebuffer();
    gl.bindFramebuffer(GL.READ_FRAMEBUFFER, other);
    gl.deleteFramebuffer(gl.createFramebuffer());
    expect(gl.getParameter(GL.READ_FRAMEBUFFER_BINDING)).toBe(other);

    const renderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(GL.RENDERBUFFER, renderbuffer);
    gl.deleteRenderbuffer(gl.createRenderbuffer());
    expect(gl.getParameter(GL.RENDERBUFFER_BINDING)).toBe(renderbuffer);
    gl.deleteRenderbuffer(renderbuffer);
    expect(gl.getParameter(GL.RENDERBUFFER_BINDING)).toBeNull();

    const texture = gl.createTexture();
    gl.activeTexture(GL.TEXTURE2);
    gl.bindTexture(GL.TEXTURE_2D, texture);
    gl.bindTexture(GL.TEXTURE_CUBE_MAP, gl.createTexture());
    gl.deleteTexture(texture);
    expect(gl.getParameter(GL.TEXTURE_BINDING_2D)).toBeNull();
    expect(gl.getParameter(GL.TEXTURE_BINDING_CUBE_MAP)).not.toBeNull();

    const sampler = gl.createSampler();
    gl.bindSampler(0, sampler);
    gl.bindSampler(1, gl.createSampler());
    gl.deleteSampler(sampler);
    gl.activeTexture(GL.TEXTURE0);
    expect(gl.getParameter(GL.SAMPLER_BINDING)).toBeNull();

    const vertexArray = gl.createVertexArray();
    gl.bindVertexArray(vertexArray);
    gl.deleteVertexArray(gl.createVertexArray());
    expect(gl.getParameter(GL.VERTEX_ARRAY_BINDING)).toBe(vertexArray);
    gl.deleteVertexArray(vertexArray);
    expect(gl.getParameter(GL.VERTEX_ARRAY_BINDING)).toBeNull();

    const transformFeedback = gl.createTransformFeedback();
    gl.bindTransformFeedback(GL.TRANSFORM_FEEDBACK, transformFeedback);
    gl.deleteTransformFeedback(gl.createTransformFeedback());
    expect(gl.getParameter(GL.TRANSFORM_FEEDBACK_BINDING)).toBe(
      transformFeedback,
    );
    gl.deleteTransformFeedback(transformFeedback);
    expect(gl.getParameter(GL.TRANSFORM_FEEDBACK_BINDING)).toBeNull();

    const query = gl.createQuery();
    gl.beginQuery(GL.ANY_SAMPLES_PASSED, query);
    gl.beginQuery(GL.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN, gl.createQuery());
    expect(gl.getQuery(GL.ANY_SAMPLES_PASSED, GL.CURRENT_QUERY)).toBe(query);
    gl.deleteQuery(query);
    expect(gl.getQuery(GL.ANY_SAMPLES_PASSED, GL.CURRENT_QUERY)).toBeNull();
    expect(
      gl.getQuery(GL.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN, GL.CURRENT_QUERY),
    ).not.toBeNull();
  });

  it('keeps the element buffer with its vertex array', () => {
    const vertexArray = gl.createVertexArray();
    const inDefault = gl.createBuffer();
    const inArray = gl.createBuffer();
    gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, inDefault);
    gl.bindVertexArray(vertexArray);
    expect(gl.getParameter(GL.ELEMENT_ARRAY_BUFFER_BINDING)).toBeNull();
    gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, inArray);
    gl.bindBufferBase(GL.UNIFORM_BUFFER, 0, inArray);
    gl.bindBufferRange(GL.UNIFORM_BUFFER, 1, inArray, 0, 16);
    expect(gl.getParameter(GL.ELEMENT_ARRAY_BUFFER_BINDING)).toBe(inArray);
    gl.bindVertexArray(null);
    expect(gl.getParameter(GL.ELEMENT_ARRAY_BUFFER_BINDING)).toBe(inDefault);
    expect(gl.getParameter(GL.UNIFORM_BUFFER_BINDING)).toBe(inArray);
  });
});

describe('getParameter', () => {
  it('names the context, as WebGL does', () => {
    expect(gl.getParameter(GL.VERSION)).toMatch(/^WebGL 2\.0/);
    expect(gl.getParameter(GL.SHADING_LANGUAGE_VERSION)).toMatch(
      /^WebGL GLSL ES 3\.00/,
    );
    expect(gl.getParameter(GL.VENDOR)).toBe('AngularLynx');
    expect(gl.getParameter(GL.RENDERER)).toBe('AngularLynx WebGL');
  });

  it('answers bindings and pixel storage itself', () => {
    const program = gl.createProgram();
    gl.useProgram(program);
    expect(gl.getParameter(GL.CURRENT_PROGRAM)).toBe(program);
    gl.activeTexture(GL.TEXTURE3);
    expect(gl.getParameter(GL.ACTIVE_TEXTURE)).toBe(GL.TEXTURE3);
    expect(gl.getParameter(GL.TEXTURE_BINDING_3D)).toBeNull();
    const texture = gl.createTexture();
    gl.bindTexture(GL.TEXTURE_2D_ARRAY, texture);
    expect(gl.getParameter(GL.TEXTURE_BINDING_2D_ARRAY)).toBe(texture);
    gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.pixelStorei(GL.UNPACK_COLORSPACE_CONVERSION_WEBGL, GL.NONE);
    expect(gl.getParameter(GL.UNPACK_FLIP_Y_WEBGL)).toBe(true);
    expect(gl.getParameter(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL)).toBe(true);
    expect(gl.getParameter(GL.UNPACK_COLORSPACE_CONVERSION_WEBGL)).toBe(
      GL.NONE,
    );
  });

  it('sends the pixel storage GLES has, and none of WebGL’s', async () => {
    expect(
      await sends(() => {
        gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(GL.PACK_ALIGNMENT, 2);
        gl.pixelStorei(GL.PACK_ROW_LENGTH, 3);
        gl.pixelStorei(GL.PACK_SKIP_PIXELS, 4);
        gl.pixelStorei(GL.PACK_SKIP_ROWS, 5);
        gl.pixelStorei(GL.UNPACK_ROW_LENGTH, 6);
      }),
    ).toEqual([
      OP.pixelStorei,
      GL.UNPACK_ALIGNMENT,
      1,
      OP.pixelStorei,
      GL.PACK_ALIGNMENT,
      2,
      OP.pixelStorei,
      GL.PACK_ROW_LENGTH,
      3,
      OP.pixelStorei,
      GL.PACK_SKIP_PIXELS,
      4,
      OP.pixelStorei,
      GL.PACK_SKIP_ROWS,
      5,
      OP.pixelStorei,
      GL.UNPACK_ROW_LENGTH,
      6,
    ]);
  });

  it('asks the driver for the rest, typed as WebGL types it', () => {
    const ask = (pname: number, answer: unknown) => {
      bridge.answers.push(answer);
      return gl.getParameter(pname);
    };
    expect(ask(GL.VIEWPORT, [0, 0, 300, 150])).toEqual(
      new Int32Array([0, 0, 300, 150]),
    );
    expect(ask(GL.COLOR_CLEAR_VALUE, [0, 0.5, 1, 1])).toEqual(
      new Float32Array([0, 0.5, 1, 1]),
    );
    expect(ask(GL.COMPRESSED_TEXTURE_FORMATS, [1, 2])).toEqual(
      new Uint32Array([1, 2]),
    );
    expect(ask(GL.COLOR_WRITEMASK, [1, 0, 1, 1])).toEqual([
      true,
      false,
      true,
      true,
    ]);
    expect(ask(GL.DEPTH_TEST, 1)).toBe(true);
    expect(ask(GL.STENCIL_REF, 3)).toBe(3);
    expect(ask(GL.SCISSOR_BOX, null)).toBeNull();
    // An array-like the bridge hands back, which a typed array's
    // constructor would read as empty (iOS).
    const arrayLike = {
      map: (f: (v: unknown) => unknown) => [1, 2, 3, 4].map(f),
    };
    expect(ask(GL.VIEWPORT, arrayLike)).toEqual(new Int32Array([1, 2, 3, 4]));
    expect(ask(GL.VIEWPORT, 'nonsense')).toEqual(new Int32Array([]));
  });

  it('knows anisotropy only with its extension', () => {
    bridge.answers.push(16);
    expect(gl.getParameter(0x84ff)).toBe(16);
    bridge.glExtensions = [];
    gl = makeContext();
    expect(gl.getParameter(0x84ff)).toBeNull();
    expect(gl.getError()).toBe(GL.INVALID_ENUM);
  });
});

describe('extensions', () => {
  it('returns each one’s constants, the same object each time', () => {
    const anisotropic = gl.getExtension('ext_texture_filter_anisotropic');
    expect(anisotropic).toEqual({
      TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe,
      MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
    });
    expect(gl.getExtension('EXT_texture_filter_anisotropic')).toBe(anisotropic);
    expect(gl.getExtension('EXT_color_buffer_float')).toEqual({});
    expect(gl.getExtension('OES_texture_float_linear')).toBeNull();
    const astc = gl.getExtension('WEBGL_compressed_texture_astc') as {
      COMPRESSED_RGBA_ASTC_4x4_KHR: number;
      getSupportedProfiles(): string[];
    };
    expect(astc.COMPRESSED_RGBA_ASTC_4x4_KHR).toBe(0x93b0);
    expect(astc.getSupportedProfiles()).toEqual(['ldr']);
  });

  it('loses the context with WEBGL_lose_context, as three.js does on dispose', () => {
    const lose = gl.getExtension('WEBGL_lose_context') as {
      loseContext(): void;
      restoreContext(): void;
    };
    lose.restoreContext();
    expect(gl.getError()).toBe(GL.INVALID_OPERATION);
    lose.loseContext();
    lose.loseContext();
    expect(bridge.destroy).toHaveBeenCalledOnce();
    expect(bridge.destroy).toHaveBeenCalledWith(7);
    expect(canvas.dispatchContextEvent).toHaveBeenCalledWith(
      'webglcontextlost',
    );
    expect(gl.isContextLost()).toBe(true);
    expect(gl.getError()).toBe(GL.CONTEXT_LOST_WEBGL);
    expect(gl.getError()).toBe(GL.NO_ERROR);
    const before = bridge.batches.length;
    gl.clear(GL.COLOR_BUFFER_BIT);
    gl.destroy();
    expect(gl.getParameter(GL.VIEWPORT)).toBeNull();
    expect(gl.getExtension('WEBGL_lose_context')).toBeNull();
    expect(gl.getSupportedExtensions()).toBeNull();
    expect(gl.getContextAttributes()).toBeNull();
    expect(gl.isEnabled(GL.BLEND)).toBe(false);
    expect(gl.isBuffer(gl.createBuffer())).toBe(false);
    expect(bridge.batches).toHaveLength(before);
  });

  it('stops sending once destroyed, as at the end of a task', async () => {
    gl.clear(GL.COLOR_BUFFER_BIT);
    gl.destroy();
    expect(await flushed()).toEqual([]);
  });
});

describe('the drawing buffer', () => {
  it('resizes, within the largest renderbuffer', async () => {
    bridge.limits.set(GL.MAX_RENDERBUFFER_SIZE, 1000);
    gl = makeContext();
    gl.resize(2000, 0);
    expect(gl.drawingBufferWidth).toBe(1000);
    expect(gl.drawingBufferHeight).toBe(1);
    expect(await flushed()).toEqual([OP.resize, 1000, 1]);
  });

  it('assumes 4096 when the driver didn’t say', () => {
    bridge.limits.set(GL.MAX_RENDERBUFFER_SIZE, undefined);
    gl = makeContext();
    gl.resize(5000, 10);
    expect(gl.drawingBufferWidth).toBe(4096);
  });

  it('has no XR', async () => {
    await expect(gl.makeXRCompatible()).rejects.toThrow(/WebXR/);
  });
});

describe('shaders and programs', () => {
  it('records the source, and asks for the compile result once per compile', async () => {
    const shader = gl.createShader(GL.FRAGMENT_SHADER)!;
    gl.shaderSource(shader, 'void main() {}');
    expect(gl.getShaderSource(shader)).toBe('void main() {}');
    gl.compileShader(shader);
    bridge.answers.push({ compiled: 1, log: 'warning' });
    expect(gl.getShaderParameter(shader, GL.COMPILE_STATUS)).toBe(true);
    expect(gl.getShaderInfoLog(shader)).toBe('warning');
    expect(gl.getShaderParameter(shader, GL.SHADER_TYPE)).toBe(
      GL.FRAGMENT_SHADER,
    );
    expect(gl.getShaderParameter(shader, GL.DELETE_STATUS)).toBe(false);
    expect(gl.getShaderParameter(shader, 0)).toBeNull();
    expect(gl.getError()).toBe(GL.INVALID_ENUM);
    expect(bridge.sent().filter((item) => item === OP.shaderInfo)).toHaveLength(
      1,
    );
    gl.compileShader(shader);
    expect(gl.getShaderInfoLog(shader)).toBe('');
    expect(gl.getShaderParameter(shader, GL.COMPILE_STATUS)).toBe(false);
  });

  it('answers nothing about another context’s shader', () => {
    const other = makeContext().createShader(GL.VERTEX_SHADER)!;
    expect(gl.getShaderParameter(other, GL.COMPILE_STATUS)).toBeNull();
    expect(gl.getShaderInfoLog(other)).toBeNull();
    expect(gl.getShaderSource(other)).toBeNull();
  });

  it('keeps a program’s shaders', async () => {
    const p = gl.createProgram();
    const vertex = gl.createShader(GL.VERTEX_SHADER)!;
    const fragment = gl.createShader(GL.FRAGMENT_SHADER)!;
    gl.attachShader(p, vertex);
    gl.attachShader(p, fragment);
    gl.detachShader(p, vertex);
    expect(gl.getAttachedShaders(p)).toEqual([fragment]);
    expect(gl.getProgramParameter(p, GL.ATTACHED_SHADERS)).toBe(1);
    gl.bindAttribLocation(p, 0, 'position');
    gl.validateProgram(p);
    const other = makeContext();
    other.attachShader(p, vertex as LynxWebGLShader);
    other.detachShader(p, vertex);
    expect(other.getAttachedShaders(p)).toBeNull();
    const sent = await flushed();
    expect(sent).toContain(OP.bindAttribLocation);
    expect(sent).toContain(OP.validateProgram);
  });

  it('fetches a program’s link results and reflection once per link', () => {
    const p = program();
    expect(gl.getProgramParameter(p, GL.LINK_STATUS)).toBe(true);
    expect(gl.getProgramParameter(p, GL.ACTIVE_UNIFORMS)).toBe(2);
    expect(gl.getProgramParameter(p, GL.ACTIVE_ATTRIBUTES)).toBe(1);
    expect(gl.getProgramParameter(p, GL.ACTIVE_UNIFORM_BLOCKS)).toBe(1);
    expect(gl.getProgramParameter(p, GL.TRANSFORM_FEEDBACK_VARYINGS)).toBe(2);
    expect(gl.getProgramParameter(p, GL.DELETE_STATUS)).toBe(false);
    expect(gl.getProgramInfoLog(p)).toBe('');
    expect(gl.getActiveUniform(p, 1)).toMatchObject({
      name: 'lights[0]',
      size: 4,
      type: GL.FLOAT_VEC3,
    });
    expect(gl.getActiveAttrib(p, 0)).toMatchObject({ name: 'position' });
    expect(gl.getActiveUniform(p, 9)).toBeNull();
    expect(gl.getError()).toBe(GL.INVALID_VALUE);
    expect(
      bridge.sent().filter((item) => item === OP.programInfo),
    ).toHaveLength(1);
  });

  it('asks the driver for what it doesn’t reflect', () => {
    const p = program();
    bridge.answers.push(1);
    expect(gl.getProgramParameter(p, GL.VALIDATE_STATUS)).toBe(true);
    bridge.answers.push(GL.SEPARATE_ATTRIBS);
    expect(gl.getProgramParameter(p, GL.TRANSFORM_FEEDBACK_BUFFER_MODE)).toBe(
      GL.SEPARATE_ATTRIBS,
    );
    const other = makeContext().createProgram();
    expect(gl.getProgramParameter(other, GL.LINK_STATUS)).toBeNull();
    expect(gl.getProgramInfoLog(other)).toBeNull();
    expect(gl.getActiveUniform(other, 0)).toBeNull();
    expect(gl.getActiveAttrib(other, 0)).toBeNull();
    expect(gl.getUniformLocation(other, 'color')).toBeNull();
    expect(gl.getAttribLocation(other, 'position')).toBe(-1);
  });

  it('copes with a program the driver says nothing about', () => {
    const p = gl.createProgram();
    gl.linkProgram(p);
    expect(gl.getProgramParameter(p, GL.LINK_STATUS)).toBe(false);
    expect(gl.getProgramInfoLog(p)).toBe('');
    expect(gl.getUniformLocation(p, 'color')).toBeNull();
  });

  it('finds uniform locations by name, from the reflection', () => {
    const p = program();
    const color = gl.getUniformLocation(p, 'color')!;
    expect(color.location).toBe(3);
    expect(gl.getUniformLocation(p, 'color')).toBe(color);
    expect(gl.getUniformLocation(p, 'lights')!.location).toBe(5);
    bridge.answers.push(6);
    expect(gl.getUniformLocation(p, 'lights[1]')!.location).toBe(6);
    bridge.answers.push(-1);
    expect(gl.getUniformLocation(p, 'missing')).toBeNull();
    expect(gl.getUniformLocation(p, 'missing')).toBeNull();
    expect(gl.getUniformLocation(p, 'other')).toBeNull();
  });

  it('finds attribute locations, from the reflection or the driver', () => {
    const p = program();
    expect(gl.getAttribLocation(p, 'position')).toBe(0);
    bridge.answers.push(2);
    expect(gl.getAttribLocation(p, 'normal')).toBe(2);
    expect(gl.getAttribLocation(p, 'uv')).toBe(-1);
  });

  it('forgets the old reflection when the program links again', () => {
    const p = program();
    gl.getUniformLocation(p, 'color');
    gl.linkProgram(p);
    bridge.answers.push({ linked: 0, log: 'error' });
    expect(gl.getProgramParameter(p, GL.LINK_STATUS)).toBe(false);
    expect(gl.getProgramInfoLog(p)).toBe('error');
    expect(gl.getProgramParameter(p, GL.ACTIVE_UNIFORMS)).toBe(0);
    expect(gl.getProgramParameter(p, GL.ACTIVE_UNIFORM_BLOCKS)).toBe(0);
    expect(gl.getProgramParameter(p, GL.TRANSFORM_FEEDBACK_VARYINGS)).toBe(0);
    // Another context can't link it: it's this one's.
    makeContext().linkProgram(p);
    expect(gl.getProgramInfoLog(p)).toBe('error');
  });

  it('asks the driver about uniform blocks, fragment outputs and varyings', () => {
    const p = program();
    bridge.answers.push(0);
    expect(gl.getUniformBlockIndex(p, 'Lights')).toBe(0);
    expect(gl.getUniformBlockIndex(p, 'Missing')).toBe(GL.INVALID_INDEX);
    bridge.answers.push('Lights');
    expect(gl.getActiveUniformBlockName(p, 0)).toBe('Lights');
    bridge.answers.push([1, 2]);
    expect(
      gl.getActiveUniformBlockParameter(
        p,
        0,
        GL.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES,
      ),
    ).toEqual(new Uint32Array([1, 2]));
    bridge.answers.push(1);
    expect(
      gl.getActiveUniformBlockParameter(
        p,
        0,
        GL.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER,
      ),
    ).toBe(true);
    bridge.answers.push(0);
    expect(
      gl.getActiveUniformBlockParameter(
        p,
        0,
        GL.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER,
      ),
    ).toBe(false);
    bridge.answers.push(64);
    expect(
      gl.getActiveUniformBlockParameter(p, 0, GL.UNIFORM_BLOCK_DATA_SIZE),
    ).toBe(64);
    bridge.answers.push([1, 0]);
    expect(gl.getActiveUniforms(p, [0, 1], GL.UNIFORM_IS_ROW_MAJOR)).toEqual([
      true,
      false,
    ]);
    bridge.answers.push([4, 8]);
    expect(gl.getActiveUniforms(p, [0, 1], GL.UNIFORM_OFFSET)).toEqual([4, 8]);
    expect(gl.getActiveUniforms(p, [0], GL.UNIFORM_OFFSET)).toBeNull();
    bridge.answers.push([0, GL.INVALID_INDEX]);
    expect(gl.getUniformIndices(p, ['color', 'missing'])).toEqual([
      0,
      GL.INVALID_INDEX,
    ]);
    expect(gl.getUniformIndices(p, ['color'])).toBeNull();
    bridge.answers.push(1);
    expect(gl.getFragDataLocation(p, 'outColor')).toBe(1);
    expect(gl.getFragDataLocation(p, 'missing')).toBe(-1);
    gl.transformFeedbackVaryings(p, ['a', 'b'], GL.INTERLEAVED_ATTRIBS);
    bridge.answers.push(['a', 1, GL.FLOAT]);
    expect(gl.getTransformFeedbackVarying(p, 0)).toMatchObject({
      name: 'a',
      size: 1,
      type: GL.FLOAT,
    });
    expect(gl.getTransformFeedbackVarying(p, 9)).toBeNull();
    gl.uniformBlockBinding(p, 0, 2);
  });

  it('reads a uniform, typed by its type', () => {
    const p = gl.createProgram();
    gl.linkProgram(p);
    const types: [number, unknown, unknown][] = [
      [GL.FLOAT, 1.5, 1.5],
      [GL.INT, [3], 3],
      [GL.SAMPLER_2D, [1], 1],
      [GL.BOOL, [1], true],
      [GL.BOOL_VEC2, [1, 0], [true, false]],
      [GL.INT_VEC3, [1, 2, 3], new Int32Array([1, 2, 3])],
      [GL.UNSIGNED_INT_VEC2, [1, 2], new Uint32Array([1, 2])],
      [GL.FLOAT_MAT2, [1, 0, 0, 1], new Float32Array([1, 0, 0, 1])],
    ];
    bridge.answers.push({
      linked: 1,
      log: '',
      uniforms: types.map(([type], i) => [`u${i}`, 1, type, i]),
      attributes: [],
    });
    gl.getProgramParameter(p, GL.LINK_STATUS);
    types.forEach(([, answer, expected], i) => {
      bridge.answers.push(answer);
      expect(gl.getUniform(p, gl.getUniformLocation(p, `u${i}`)!)).toEqual(
        expected,
      );
    });
    expect(gl.getUniform(p, gl.getUniformLocation(p, 'u0')!)).toBeNull();
    // A location the reflection doesn't list reads as a float.
    bridge.answers.push(9);
    expect(
      gl.getUniform(p, { location: 99 } as unknown as LynxWebGLUniformLocation),
    ).toBe(9);
  });
});

describe('uniforms', () => {
  let p: LynxWebGLProgram;
  let color: LynxWebGLUniformLocation;

  beforeEach(() => {
    p = program();
    color = gl.getUniformLocation(p, 'color')!;
    gl.useProgram(p);
  });

  it.each([
    ['uniform1f', [1], [OP.uniform1f, 3, 1]],
    ['uniform2f', [1, 2], [OP.uniform2f, 3, 1, 2]],
    ['uniform3f', [1, 2, 3], [OP.uniform3f, 3, 1, 2, 3]],
    ['uniform4f', [1, 2, 3, 4], [OP.uniform4f, 3, 1, 2, 3, 4]],
    ['uniform1i', [1], [OP.uniform1i, 3, 1]],
    ['uniform2i', [1, 2], [OP.uniform2i, 3, 1, 2]],
    ['uniform3i', [1, 2, 3], [OP.uniform3i, 3, 1, 2, 3]],
    ['uniform4i', [1, 2, 3, 4], [OP.uniform4i, 3, 1, 2, 3, 4]],
    ['uniform1ui', [1], [OP.uniform1ui, 3, 1]],
    ['uniform2ui', [1, 2], [OP.uniform2ui, 3, 1, 2]],
    ['uniform3ui', [1, 2, 3], [OP.uniform3ui, 3, 1, 2, 3]],
    ['uniform4ui', [1, 2, 3, 4], [OP.uniform4ui, 3, 1, 2, 3, 4]],
    ['uniform1fv', [new Float32Array([1])], [OP.uniform1fv, 3, [1]]],
    ['uniform2fv', [[1, 2]], [OP.uniform2fv, 3, [1, 2]]],
    [
      'uniform3fv',
      [new Float32Array([0, 1, 2, 3]), 1],
      [OP.uniform3fv, 3, [1, 2, 3]],
    ],
    [
      'uniform4fv',
      [new Float32Array([0, 1, 2, 3, 4, 5]), 1, 4],
      [OP.uniform4fv, 3, [1, 2, 3, 4]],
    ],
    ['uniform1iv', [[1]], [OP.uniform1iv, 3, [1]]],
    ['uniform2iv', [[1, 2]], [OP.uniform2iv, 3, [1, 2]]],
    ['uniform3iv', [[1, 2, 3]], [OP.uniform3iv, 3, [1, 2, 3]]],
    ['uniform4iv', [[1, 2, 3, 4]], [OP.uniform4iv, 3, [1, 2, 3, 4]]],
    ['uniform1uiv', [[1]], [OP.uniform1uiv, 3, [1]]],
    ['uniform2uiv', [[1, 2]], [OP.uniform2uiv, 3, [1, 2]]],
    ['uniform3uiv', [[1, 2, 3]], [OP.uniform3uiv, 3, [1, 2, 3]]],
    ['uniform4uiv', [[1, 2, 3, 4]], [OP.uniform4uiv, 3, [1, 2, 3, 4]]],
    [
      'uniformMatrix2fv',
      [false, [1, 0, 0, 1]],
      [OP.uniformMatrix2fv, 3, 0, [1, 0, 0, 1]],
    ],
    [
      'uniformMatrix3fv',
      [true, Array.from({ length: 9 }, () => 1)],
      [OP.uniformMatrix3fv, 3, 1, Array.from({ length: 9 }, () => 1)],
    ],
    [
      'uniformMatrix4fv',
      [false, new Float32Array(16)],
      [OP.uniformMatrix4fv, 3, 0, Array.from({ length: 16 }, () => 0)],
    ],
    [
      'uniformMatrix2x3fv',
      [false, Array.from({ length: 6 }, () => 2)],
      [OP.uniformMatrix2x3fv, 3, 0, Array.from({ length: 6 }, () => 2)],
    ],
    [
      'uniformMatrix3x2fv',
      [false, Array.from({ length: 6 }, () => 2)],
      [OP.uniformMatrix3x2fv, 3, 0, Array.from({ length: 6 }, () => 2)],
    ],
    [
      'uniformMatrix2x4fv',
      [false, Array.from({ length: 8 }, () => 2)],
      [OP.uniformMatrix2x4fv, 3, 0, Array.from({ length: 8 }, () => 2)],
    ],
    [
      'uniformMatrix4x2fv',
      [false, Array.from({ length: 8 }, () => 2)],
      [OP.uniformMatrix4x2fv, 3, 0, Array.from({ length: 8 }, () => 2)],
    ],
    [
      'uniformMatrix3x4fv',
      [false, Array.from({ length: 12 }, () => 2)],
      [OP.uniformMatrix3x4fv, 3, 0, Array.from({ length: 12 }, () => 2)],
    ],
    [
      'uniformMatrix4x3fv',
      [false, Array.from({ length: 12 }, () => 2)],
      [OP.uniformMatrix4x3fv, 3, 0, Array.from({ length: 12 }, () => 2)],
    ],
  ] as [keyof LynxWebGL2RenderingContext, unknown[], unknown[]][])(
    '%s',
    async (method, args, expected) => {
      const sent = await sends(() =>
        (gl[method] as (...a: unknown[]) => void)(color, ...args),
      );
      expect(sent.slice(-expected.length)).toEqual(expected);
    },
  );

  it('copies the values, which the app may change before they’re sent', async () => {
    const values = new Float32Array([1, 2, 3, 4]);
    gl.uniform4fv(color, values);
    values[0] = 9;
    expect((await flushed()).at(-1)).toEqual([1, 2, 3, 4]);
  });

  it('does nothing for a null location', async () => {
    gl.uniform1f(null, 1);
    gl.uniform4fv(null, [1, 2, 3, 4]);
    gl.uniformMatrix4fv(null, false, new Float32Array(16));
    expect(await flushed()).not.toContain(OP.uniform1f);
    expect(gl.getError()).toBe(GL.NO_ERROR);
  });

  it('refuses a location from another program, or an old link', () => {
    gl.useProgram(gl.createProgram());
    gl.uniform1f(color, 1);
    expect(gl.getError()).toBe(GL.INVALID_OPERATION);
    gl.useProgram(p);
    gl.linkProgram(p);
    gl.uniform1f(color, 1);
    expect(gl.getError()).toBe(GL.INVALID_OPERATION);
  });
});

describe('buffers', () => {
  it('sends a size, nothing, or the bytes', async () => {
    expect(
      await sends(() => {
        gl.bufferData(GL.ARRAY_BUFFER, 64, GL.STATIC_DRAW);
        gl.bufferData(GL.ARRAY_BUFFER, null, GL.STATIC_DRAW);
        gl.bufferData(
          GL.ARRAY_BUFFER,
          new Uint8Array([1, 2, 3, 4, 5]),
          GL.STATIC_DRAW,
        );
        gl.bufferData(
          GL.ARRAY_BUFFER,
          new Uint16Array([1, 2, 3]),
          GL.STATIC_DRAW,
          1,
          1,
        );
        gl.bufferSubData(GL.ARRAY_BUFFER, 4, new Uint8Array([9]).buffer);
      }),
    ).toEqual([
      OP.bufferData,
      GL.ARRAY_BUFFER,
      64,
      GL.STATIC_DRAW,
      OP.bufferData,
      GL.ARRAY_BUFFER,
      0,
      GL.STATIC_DRAW,
      OP.bufferData,
      GL.ARRAY_BUFFER,
      words([1, 2, 3, 4, 5]),
      GL.STATIC_DRAW,
      OP.bufferData,
      GL.ARRAY_BUFFER,
      words([2, 0]),
      GL.STATIC_DRAW,
      OP.bufferSubData,
      GL.ARRAY_BUFFER,
      4,
      words([9]),
    ]);
  });

  it('reads bytes back', () => {
    bridge.answers.push(words([5, 6, 7]));
    const destination = new Uint8Array(4);
    gl.getBufferSubData(GL.ARRAY_BUFFER, 8, destination, 1, 3);
    expect(destination).toEqual(new Uint8Array([0, 5, 6, 7]));
    expect(bridge.batches.at(-1)).toEqual([
      OP.getBufferSubData,
      GL.ARRAY_BUFFER,
      8,
      3,
    ]);
    gl.getBufferSubData(GL.ARRAY_BUFFER, 0, destination);
    expect(destination).toEqual(new Uint8Array([0, 5, 6, 7]));
    bridge.answers.push(64);
    expect(gl.getBufferParameter(GL.ARRAY_BUFFER, GL.BUFFER_SIZE)).toBe(64);
  });
});

describe('textures', () => {
  const image = (bakedOptions: boolean) => ({
    [NATIVE_IMAGE]: { id: 5, width: 4, height: 2, bakedOptions },
  });

  it('uploads a decoded image by id, with the pixel storage it needs', async () => {
    gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    expect(
      await sends(() => {
        gl.texImage2D(
          GL.TEXTURE_2D,
          0,
          GL.RGBA,
          GL.RGBA,
          GL.UNSIGNED_BYTE,
          image(false),
        );
        gl.texSubImage2D(
          GL.TEXTURE_2D,
          0,
          1,
          2,
          GL.RGBA,
          GL.UNSIGNED_BYTE,
          image(true),
        );
      }),
    ).toEqual([
      OP.texImage2D,
      GL.TEXTURE_2D,
      0,
      GL.RGBA,
      4,
      2,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      { image: 5, flipY: true, premultiply: true },
      OP.texSubImage2D,
      GL.TEXTURE_2D,
      0,
      1,
      2,
      4,
      2,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      // An ImageBitmap's decode already applied them.
      { image: 5, flipY: false, premultiply: false },
    ]);
  });

  it('uploads typed arrays, ImageData, nothing, or from a buffer', async () => {
    const sent = await sends(() => {
      gl.texImage2D(
        GL.TEXTURE_2D,
        0,
        GL.RGBA,
        1,
        1,
        0,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        new Uint8Array([1, 2, 3, 4]),
      );
      gl.texImage2D(
        GL.TEXTURE_2D,
        0,
        GL.RGBA,
        1,
        1,
        0,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4]),
        4,
      );
      gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, {
        width: 1,
        height: 1,
        data: new Uint8ClampedArray([5, 6, 7, 8]),
      });
      gl.texImage2D(
        GL.TEXTURE_2D,
        0,
        GL.RGBA,
        1,
        1,
        0,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        null,
      );
      gl.texSubImage2D(
        GL.TEXTURE_2D,
        0,
        0,
        0,
        1,
        1,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        16,
      );
      gl.texSubImage2D(
        GL.TEXTURE_2D,
        0,
        0,
        0,
        1,
        1,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0, 9, 9, 9, 9]),
        4,
      );
      gl.texImage3D(
        GL.TEXTURE_3D,
        0,
        GL.RGBA,
        1,
        1,
        1,
        0,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        undefined,
      );
      gl.texSubImage3D(
        GL.TEXTURE_3D,
        0,
        0,
        0,
        0,
        1,
        1,
        1,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        new Uint8Array([1, 2, 3, 4]),
      );
    });
    expect(sent).toEqual([
      OP.texImage2D,
      GL.TEXTURE_2D,
      0,
      GL.RGBA,
      1,
      1,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      words([1, 2, 3, 4]),
      OP.texImage2D,
      GL.TEXTURE_2D,
      0,
      GL.RGBA,
      1,
      1,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      words([1, 2, 3, 4]),
      OP.texImage2D,
      GL.TEXTURE_2D,
      0,
      GL.RGBA,
      1,
      1,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      words([5, 6, 7, 8]),
      OP.texImage2D,
      GL.TEXTURE_2D,
      0,
      GL.RGBA,
      1,
      1,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      null,
      OP.texSubImage2D,
      GL.TEXTURE_2D,
      0,
      0,
      0,
      1,
      1,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      16,
      OP.texSubImage2D,
      GL.TEXTURE_2D,
      0,
      0,
      0,
      1,
      1,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      words([9, 9, 9, 9]),
      OP.texImage3D,
      GL.TEXTURE_3D,
      0,
      GL.RGBA,
      1,
      1,
      1,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      null,
      OP.texSubImage3D,
      GL.TEXTURE_3D,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      words([1, 2, 3, 4]),
    ]);
  });

  it('flips and premultiplies typed arrays as asked, a copy of them', async () => {
    const pixels = new Uint8Array([
      // Row 0: opaque white, half-transparent white.
      255, 255, 255, 255, 200, 100, 50, 128,
      // Row 1.
      1, 2, 3, 255, 4, 5, 6, 0,
    ]);
    gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(
      GL.TEXTURE_2D,
      0,
      GL.RGBA,
      2,
      2,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      pixels,
    );
    expect((await flushed()).at(-1)).toEqual(
      words([1, 2, 3, 255, 0, 0, 0, 0, 255, 255, 255, 255, 100, 50, 25, 128]),
    );
    expect(pixels[0]).toBe(255);
  });

  it('flips each image of a 3D upload, and only premultiplies 8-bit alpha', async () => {
    gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      GL.TEXTURE_3D,
      0,
      GL.R8,
      1,
      2,
      2,
      0,
      GL.RED,
      GL.UNSIGNED_BYTE,
      // Two 1x2 images, and a spare byte.
      new Uint8Array([1, 2, 3, 4, 9]),
    );
    expect((await flushed()).at(-1)).toEqual(words([2, 1, 4, 3, 9]));
  });

  it('premultiplies without flipping', async () => {
    gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(
      GL.TEXTURE_2D,
      0,
      0,
      0,
      1,
      1,
      GL.LUMINANCE_ALPHA,
      GL.UNSIGNED_BYTE,
      new Uint8Array([200, 128, 0, 0]),
    );
    expect((await flushed()).at(-1)).toEqual(words([100, 128, 0, 0]));
  });

  it('refuses a source it can’t upload', () => {
    expect(() =>
      gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, {}),
    ).toThrow(TypeError);
    expect(() =>
      gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, {
        width: 1,
      }),
    ).toThrow(/canvas/);
    expect(() =>
      gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, GL.RGBA, GL.UNSIGNED_BYTE, 'x'),
    ).toThrow(TypeError);
  });

  it('sends compressed data, or a buffer offset', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      await sends(() => {
        gl.compressedTexImage2D(GL.TEXTURE_2D, 0, 0x9274, 4, 4, 0, data);
        gl.compressedTexImage2D(GL.TEXTURE_2D, 0, 0x9274, 4, 4, 0, 8, 16);
        gl.compressedTexImage3D(
          GL.TEXTURE_3D,
          0,
          0x9274,
          4,
          4,
          1,
          0,
          data,
          4,
          4,
        );
        gl.compressedTexSubImage2D(
          GL.TEXTURE_2D,
          0,
          0,
          0,
          4,
          4,
          0x9274,
          data,
          4,
        );
        gl.compressedTexSubImage3D(
          GL.TEXTURE_3D,
          0,
          0,
          0,
          0,
          4,
          4,
          1,
          0x9274,
          8,
          0,
        );
      }),
    ).toEqual([
      OP.compressedTexImage2D,
      GL.TEXTURE_2D,
      0,
      0x9274,
      4,
      4,
      0,
      words([1, 2, 3, 4, 5, 6, 7, 8]),
      8,
      OP.compressedTexImage2D,
      GL.TEXTURE_2D,
      0,
      0x9274,
      4,
      4,
      0,
      16,
      8,
      OP.compressedTexImage3D,
      GL.TEXTURE_3D,
      0,
      0x9274,
      4,
      4,
      1,
      0,
      words([5, 6, 7, 8]),
      4,
      OP.compressedTexSubImage2D,
      GL.TEXTURE_2D,
      0,
      0,
      0,
      4,
      4,
      0x9274,
      words([5, 6, 7, 8]),
      4,
      OP.compressedTexSubImage3D,
      GL.TEXTURE_3D,
      0,
      0,
      0,
      0,
      4,
      4,
      1,
      0x9274,
      0,
      8,
    ]);
  });

  it('asks the driver about textures and samplers', () => {
    bridge.answers.push(1);
    expect(gl.getTexParameter(GL.TEXTURE_2D, GL.TEXTURE_IMMUTABLE_FORMAT)).toBe(
      true,
    );
    bridge.answers.push(GL.LINEAR);
    expect(gl.getTexParameter(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER)).toBe(
      GL.LINEAR,
    );
    const sampler = gl.createSampler();
    gl.samplerParameteri(sampler, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
    gl.samplerParameterf(sampler, GL.TEXTURE_MAX_LOD, 2);
    bridge.answers.push(2);
    expect(gl.getSamplerParameter(sampler, GL.TEXTURE_MAX_LOD)).toBe(2);
  });
});

describe('pixels', () => {
  it('reads pixels into the array, at the pack settings’ size', () => {
    gl.pixelStorei(GL.PACK_ALIGNMENT, 1);
    bridge.answers.push(words([1, 2, 3, 4, 5, 6, 7, 8]));
    const destination = new Uint8Array(12);
    gl.readPixels(0, 0, 2, 1, GL.RGBA, GL.UNSIGNED_BYTE, destination, 4);
    expect(destination).toEqual(
      new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]),
    );
    expect(bridge.batches.at(-1)).toEqual([
      OP.pixelStorei,
      GL.PACK_ALIGNMENT,
      1,
      OP.readPixels,
      0,
      0,
      2,
      1,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      8,
    ]);
  });

  it('works out the size from the row length and skips', () => {
    gl.pixelStorei(GL.PACK_ROW_LENGTH, 4);
    gl.pixelStorei(GL.PACK_SKIP_PIXELS, 1);
    gl.pixelStorei(GL.PACK_SKIP_ROWS, 1);
    gl.readPixels(0, 0, 2, 2, GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array(64));
    // Rows of 16 bytes: two rows skipped and one read, then 3 pixels.
    expect(bridge.batches.at(-1)!.at(-1)).toBe(2 * 16 + 3 * 4);
    gl.readPixels(0, 0, 0, 2, GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array(0));
    expect(bridge.batches.at(-1)!.at(-1)).toBe(0);
  });

  it('fails without room for the pixels, or without an array', () => {
    gl.readPixels(0, 0, 2, 2, GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array(4));
    expect(gl.getError()).toBe(GL.INVALID_OPERATION);
    gl.readPixels(0, 0, 2, 2, GL.RGBA, GL.UNSIGNED_BYTE, null);
    expect(gl.getError()).toBe(GL.INVALID_VALUE);
  });

  it('leaves the array alone when the driver answers nothing', () => {
    const destination = new Uint8Array([7, 7, 7, 7]);
    gl.readPixels(0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, destination);
    expect(destination).toEqual(new Uint8Array([7, 7, 7, 7]));
  });

  it.each([
    [GL.RGBA, GL.UNSIGNED_BYTE, 4],
    [GL.RGB, GL.UNSIGNED_BYTE, 3],
    [GL.RG, GL.BYTE, 2],
    [GL.RED, GL.UNSIGNED_BYTE, 1],
    [GL.LUMINANCE_ALPHA, GL.UNSIGNED_BYTE, 2],
    [GL.DEPTH_STENCIL, GL.UNSIGNED_INT_24_8, 4],
    [GL.RGBA, GL.HALF_FLOAT, 8],
    [GL.RGBA, 0x8d61, 8],
    [GL.RG_INTEGER, GL.SHORT, 4],
    [GL.RGB_INTEGER, GL.UNSIGNED_SHORT, 6],
    [GL.RGBA_INTEGER, GL.INT, 16],
    [GL.RGB, GL.UNSIGNED_SHORT_5_6_5, 2],
    [GL.RGBA, GL.UNSIGNED_SHORT_4_4_4_4, 2],
    [GL.RGBA, GL.UNSIGNED_SHORT_5_5_5_1, 2],
    [GL.RGBA, GL.UNSIGNED_INT_2_10_10_10_REV, 4],
    [GL.RGB, GL.UNSIGNED_INT_10F_11F_11F_REV, 4],
    [GL.RGB, GL.UNSIGNED_INT_5_9_9_9_REV, 4],
    [GL.DEPTH_STENCIL, GL.FLOAT_32_UNSIGNED_INT_24_8_REV, 8],
    [GL.RGBA, GL.FLOAT, 16],
  ])('pixelSize(%s, %s) is %s', (format, type, size) => {
    expect(pixelSize(format, type)).toBe(size);
  });
});

describe('framebuffers', () => {
  it('knows what’s attached to the bound one', () => {
    const framebuffer = gl.createFramebuffer();
    const texture = gl.createTexture();
    const renderbuffer = gl.createRenderbuffer();
    expect(
      gl.getFramebufferAttachmentParameter(
        GL.FRAMEBUFFER,
        GL.COLOR_ATTACHMENT0,
        GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
      ),
    ).toBeNull();
    gl.framebufferTexture2D(
      GL.FRAMEBUFFER,
      GL.COLOR_ATTACHMENT0,
      GL.TEXTURE_2D,
      texture,
      0,
    );
    gl.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    expect(
      gl.getFramebufferAttachmentParameter(
        GL.READ_FRAMEBUFFER,
        GL.COLOR_ATTACHMENT0,
        GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
      ),
    ).toBeNull();
    gl.framebufferTexture2D(
      GL.FRAMEBUFFER,
      GL.COLOR_ATTACHMENT0,
      GL.TEXTURE_2D,
      texture,
      0,
    );
    gl.framebufferTextureLayer(
      GL.FRAMEBUFFER,
      GL.COLOR_ATTACHMENT1,
      texture,
      0,
      1,
    );
    gl.framebufferRenderbuffer(
      GL.FRAMEBUFFER,
      GL.DEPTH_STENCIL_ATTACHMENT,
      GL.RENDERBUFFER,
      renderbuffer,
    );
    const attached = (attachment: number) =>
      gl.getFramebufferAttachmentParameter(
        GL.READ_FRAMEBUFFER,
        attachment,
        GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
      );
    expect(attached(GL.COLOR_ATTACHMENT0)).toBe(texture);
    expect(attached(GL.COLOR_ATTACHMENT1)).toBe(texture);
    expect(attached(GL.DEPTH_ATTACHMENT)).toBe(renderbuffer);
    expect(attached(GL.STENCIL_ATTACHMENT)).toBe(renderbuffer);
    expect(attached(GL.COLOR_ATTACHMENT2)).toBeNull();
    bridge.answers.push(GL.TEXTURE);
    expect(
      gl.getFramebufferAttachmentParameter(
        GL.FRAMEBUFFER,
        GL.COLOR_ATTACHMENT0,
        GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE,
      ),
    ).toBe(GL.TEXTURE);
    bridge.answers.push(GL.FRAMEBUFFER_COMPLETE);
    expect(gl.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(
      GL.FRAMEBUFFER_COMPLETE,
    );
    expect(gl.checkFramebufferStatus(GL.FRAMEBUFFER)).toBe(0);
    bridge.answers.push(4);
    expect(
      gl.getRenderbufferParameter(GL.RENDERBUFFER, GL.RENDERBUFFER_SAMPLES),
    ).toBe(4);
    bridge.answers.push([4, 2]);
    expect(
      gl.getInternalformatParameter(GL.RENDERBUFFER, GL.RGBA8, GL.SAMPLES),
    ).toEqual(new Int32Array([4, 2]));
    expect(
      gl.getInternalformatParameter(GL.RENDERBUFFER, GL.RGBA8, GL.SAMPLES),
    ).toBeNull();
  });
});

describe('vertex attributes', () => {
  it('asks the driver, typed as WebGL types it', () => {
    expect(
      gl.getVertexAttrib(0, GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
    ).toBeNull();
    bridge.answers.push([1, 2, 3, 4]);
    expect(gl.getVertexAttrib(0, GL.CURRENT_VERTEX_ATTRIB)).toEqual(
      new Float32Array([1, 2, 3, 4]),
    );
    expect(gl.getVertexAttrib(0, GL.CURRENT_VERTEX_ATTRIB)).toEqual(
      new Float32Array([0, 0, 0, 1]),
    );
    for (const pname of [
      GL.VERTEX_ATTRIB_ARRAY_ENABLED,
      GL.VERTEX_ATTRIB_ARRAY_NORMALIZED,
      GL.VERTEX_ATTRIB_ARRAY_INTEGER,
    ]) {
      bridge.answers.push(1);
      expect(gl.getVertexAttrib(0, pname)).toBe(true);
    }
    bridge.answers.push(3);
    expect(gl.getVertexAttrib(0, GL.VERTEX_ATTRIB_ARRAY_SIZE)).toBe(3);
    bridge.answers.push(12);
    expect(gl.getVertexAttribOffset(0, GL.VERTEX_ATTRIB_ARRAY_POINTER)).toBe(
      12,
    );
    expect(gl.getVertexAttribOffset(0, GL.VERTEX_ATTRIB_ARRAY_POINTER)).toBe(0);
  });
});

describe('queries, syncs and transform feedback', () => {
  it('asks the driver', () => {
    const query = gl.createQuery();
    expect(gl.getQuery(GL.ANY_SAMPLES_PASSED, GL.QUERY_RESULT)).toBeNull();
    expect(gl.getQuery(GL.ANY_SAMPLES_PASSED, GL.CURRENT_QUERY)).toBeNull();
    bridge.answers.push(1);
    expect(gl.getQueryParameter(query, GL.QUERY_RESULT_AVAILABLE)).toBe(true);
    bridge.answers.push(5);
    expect(gl.getQueryParameter(query, GL.QUERY_RESULT)).toBe(5);
    gl.endQuery(GL.ANY_SAMPLES_PASSED);

    const sync = gl.fenceSync(GL.SYNC_GPU_COMMANDS_COMPLETE, 0);
    bridge.answers.push(GL.ALREADY_SIGNALED);
    expect(gl.clientWaitSync(sync, 0, 0)).toBe(GL.ALREADY_SIGNALED);
    expect(gl.clientWaitSync(sync, 0, 0)).toBe(GL.WAIT_FAILED);
    bridge.answers.push(GL.SIGNALED);
    expect(gl.getSyncParameter(sync, GL.SYNC_STATUS)).toBe(GL.SIGNALED);

    expect(gl.getIndexedParameter(GL.UNIFORM_BUFFER_BINDING, 0)).toBeNull();
    expect(
      gl.getIndexedParameter(GL.TRANSFORM_FEEDBACK_BUFFER_BINDING, 0),
    ).toBeNull();
    bridge.answers.push(256);
    expect(gl.getIndexedParameter(GL.UNIFORM_BUFFER_SIZE, 0)).toBe(256);
  });
});
