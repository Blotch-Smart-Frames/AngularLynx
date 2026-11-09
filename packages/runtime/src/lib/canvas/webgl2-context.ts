// cspell:words PVRTC BPPV PUNCHTHROUGH
import {
  bytesOf,
  type EncodedImage,
  fromWords,
  numbersFrom,
  toWords,
  type WebGLBridge,
} from './webgl-bridge';
import { WEBGL2_CONSTANTS as GL } from './webgl-constants';
import {
  type ActiveVariable,
  LynxWebGLActiveInfo,
  LynxWebGLBuffer,
  LynxWebGLFramebuffer,
  LynxWebGLProgram,
  LynxWebGLQuery,
  LynxWebGLRenderbuffer,
  LynxWebGLSampler,
  LynxWebGLShader,
  LynxWebGLShaderPrecisionFormat,
  LynxWebGLSync,
  LynxWebGLTexture,
  LynxWebGLTransformFeedback,
  LynxWebGLUniformLocation,
  LynxWebGLVertexArrayObject,
  type ProgramInfo,
  type WebGLObjectHandle,
} from './webgl-objects';
import { OP } from './webgl-ops';
import { nativeImageOf } from './native-image';

/** The `<canvas>` a context draws into, as the context needs it. */
export type WebGLCanvasHost = {
  readonly width: number;
  readonly height: number;
  /** Fires `webglcontextlost` and the like, which three.js listens for. */
  dispatchContextEvent(type: string): boolean;
};

/** WebGLContextAttributes, with WebGL's defaults filled in. */
export type LynxWebGLContextAttributes = {
  alpha: boolean;
  antialias: boolean;
  depth: boolean;
  desynchronized: boolean;
  failIfMajorPerformanceCaveat: boolean;
  powerPreference: 'default' | 'high-performance' | 'low-power';
  premultipliedAlpha: boolean;
  preserveDrawingBuffer: boolean;
  stencil: boolean;
};

export const contextAttributesFrom = (
  requested: Partial<LynxWebGLContextAttributes> | undefined,
): LynxWebGLContextAttributes => ({
  alpha: requested?.alpha ?? true,
  antialias: requested?.antialias ?? true,
  depth: requested?.depth ?? true,
  desynchronized: false,
  failIfMajorPerformanceCaveat:
    requested?.failIfMajorPerformanceCaveat ?? false,
  powerPreference: requested?.powerPreference ?? 'default',
  premultipliedAlpha: requested?.premultipliedAlpha ?? true,
  preserveDrawingBuffer: requested?.preserveDrawingBuffer ?? false,
  stencil: requested?.stencil ?? false,
});

type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

type NumberList = ArrayLike<number> & {
  slice?: unknown;
  subarray?: unknown;
};

// The context's own WebGL extensions, from the GL ones the driver lists. Each
// WebGL extension's object holds its constants (and loseContext's methods).
// OpenGL ES 3.0 has ETC2 and EAC built in, so WEBGL_compressed_texture_etc is
// always there.
const EXTENSIONS_FROM_GL: Record<string, string[]> = {
  EXT_color_buffer_float: ['GL_EXT_color_buffer_float'],
  EXT_color_buffer_half_float: [
    'GL_EXT_color_buffer_half_float',
    'GL_EXT_color_buffer_float',
  ],
  EXT_float_blend: ['GL_EXT_float_blend'],
  EXT_texture_filter_anisotropic: ['GL_EXT_texture_filter_anisotropic'],
  EXT_texture_norm16: ['GL_EXT_texture_norm16'],
  OES_texture_float_linear: ['GL_OES_texture_float_linear'],
  WEBGL_compressed_texture_astc: ['GL_KHR_texture_compression_astc_ldr'],
  WEBGL_compressed_texture_pvrtc: ['GL_IMG_texture_compression_pvrtc'],
  WEBGL_compressed_texture_s3tc: [
    'GL_EXT_texture_compression_s3tc',
    'GL_EXT_texture_compression_dxt1',
  ],
};

const ALWAYS_EXTENSIONS = [
  'WEBGL_compressed_texture_etc',
  'WEBGL_debug_renderer_info',
  'WEBGL_lose_context',
];

const EXTENSION_CONSTANTS: Record<string, Record<string, number>> = {
  EXT_color_buffer_half_float: {
    RGBA16F_EXT: 0x881a,
    RGB16F_EXT: 0x881b,
    FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT: 0x8211,
    UNSIGNED_NORMALIZED_EXT: 0x8c17,
  },
  EXT_texture_filter_anisotropic: {
    TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe,
    MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
  },
  EXT_texture_norm16: {
    R16_EXT: 0x822a,
    RG16_EXT: 0x822c,
    RGB16_EXT: 0x8054,
    RGBA16_EXT: 0x805b,
    R16_SNORM_EXT: 0x8f98,
    RG16_SNORM_EXT: 0x8f99,
    RGB16_SNORM_EXT: 0x8f9a,
    RGBA16_SNORM_EXT: 0x8f9b,
  },
  WEBGL_compressed_texture_astc: Object.fromEntries(
    [
      '4x4',
      '5x4',
      '5x5',
      '6x5',
      '6x6',
      '8x5',
      '8x6',
      '8x8',
      '10x5',
      '10x6',
      '10x8',
      '10x10',
      '12x10',
      '12x12',
    ].flatMap((size, index) => [
      [`COMPRESSED_RGBA_ASTC_${size}_KHR`, 0x93b0 + index],
      [`COMPRESSED_SRGB8_ALPHA8_ASTC_${size}_KHR`, 0x93d0 + index],
    ]),
  ),
  WEBGL_compressed_texture_etc: {
    COMPRESSED_R11_EAC: 0x9270,
    COMPRESSED_SIGNED_R11_EAC: 0x9271,
    COMPRESSED_RG11_EAC: 0x9272,
    COMPRESSED_SIGNED_RG11_EAC: 0x9273,
    COMPRESSED_RGB8_ETC2: 0x9274,
    COMPRESSED_SRGB8_ETC2: 0x9275,
    COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2: 0x9276,
    COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2: 0x9277,
    COMPRESSED_RGBA8_ETC2_EAC: 0x9278,
    COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: 0x9279,
  },
  WEBGL_compressed_texture_pvrtc: {
    COMPRESSED_RGB_PVRTC_4BPPV1_IMG: 0x8c00,
    COMPRESSED_RGB_PVRTC_2BPPV1_IMG: 0x8c01,
    COMPRESSED_RGBA_PVRTC_4BPPV1_IMG: 0x8c02,
    COMPRESSED_RGBA_PVRTC_2BPPV1_IMG: 0x8c03,
  },
  WEBGL_compressed_texture_s3tc: {
    COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f0,
    COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83f1,
    COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83f2,
    COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83f3,
  },
  WEBGL_debug_renderer_info: {
    UNMASKED_VENDOR_WEBGL: 0x9245,
    UNMASKED_RENDERER_WEBGL: 0x9246,
  },
};

// WebGL-only pixel storage, which GLES doesn't know: the context keeps it and
// applies it to uploads itself.
const UNPACK_FLIP_Y_WEBGL = GL.UNPACK_FLIP_Y_WEBGL;
const UNPACK_PREMULTIPLY_ALPHA_WEBGL = GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL;
const UNPACK_COLORSPACE_CONVERSION_WEBGL =
  GL.UNPACK_COLORSPACE_CONVERSION_WEBGL;
const MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84ff;

// Parameters that never change for a context: fetched together when it's
// made, so three.js's capability checks cost no calls.
const CONSTANT_PARAMETERS: number[] = [
  // MAX_CLIENT_WAIT_TIMEOUT_WEBGL is WebGL's own, which GLES doesn't know.
  ...Object.entries(GL)
    .filter(([name]) => name.startsWith('MAX_') && !name.endsWith('_WEBGL'))
    .map(([, value]) => value),
  GL.ALIASED_LINE_WIDTH_RANGE,
  GL.ALIASED_POINT_SIZE_RANGE,
  GL.SUBPIXEL_BITS,
  GL.UNIFORM_BUFFER_OFFSET_ALIGNMENT,
  GL.MIN_PROGRAM_TEXEL_OFFSET,
];

const FLOAT_VECTOR_PARAMETERS = new Set<number>([
  GL.ALIASED_LINE_WIDTH_RANGE,
  GL.ALIASED_POINT_SIZE_RANGE,
  GL.BLEND_COLOR,
  GL.COLOR_CLEAR_VALUE,
  GL.DEPTH_RANGE,
]);
const INT_VECTOR_PARAMETERS = new Set<number>([
  GL.MAX_VIEWPORT_DIMS,
  GL.SCISSOR_BOX,
  GL.VIEWPORT,
]);
const BOOLEAN_PARAMETERS = new Set<number>([
  GL.BLEND,
  GL.CULL_FACE,
  GL.DEPTH_TEST,
  GL.DEPTH_WRITEMASK,
  GL.DITHER,
  GL.POLYGON_OFFSET_FILL,
  GL.RASTERIZER_DISCARD,
  GL.SAMPLE_ALPHA_TO_COVERAGE,
  GL.SAMPLE_COVERAGE,
  GL.SAMPLE_COVERAGE_INVERT,
  GL.SCISSOR_TEST,
  GL.STENCIL_TEST,
  GL.TRANSFORM_FEEDBACK_ACTIVE,
  GL.TRANSFORM_FEEDBACK_PAUSED,
]);

const SHADER_TYPES = [GL.VERTEX_SHADER, GL.FRAGMENT_SHADER];
const PRECISION_TYPES = [
  GL.LOW_FLOAT,
  GL.MEDIUM_FLOAT,
  GL.HIGH_FLOAT,
  GL.LOW_INT,
  GL.MEDIUM_INT,
  GL.HIGH_INT,
];

/**
 * Bytes per pixel component for a type, or per pixel for the packed ones.
 */
const typeSize = (type: number): { bytes: number; packed: boolean } => {
  switch (type) {
    case GL.UNSIGNED_BYTE:
    case GL.BYTE:
      return { bytes: 1, packed: false };
    case GL.UNSIGNED_SHORT:
    case GL.SHORT:
    case GL.HALF_FLOAT:
    case 0x8d61: // HALF_FLOAT_OES
      return { bytes: 2, packed: false };
    case GL.UNSIGNED_SHORT_5_6_5:
    case GL.UNSIGNED_SHORT_4_4_4_4:
    case GL.UNSIGNED_SHORT_5_5_5_1:
      return { bytes: 2, packed: true };
    case GL.UNSIGNED_INT_2_10_10_10_REV:
    case GL.UNSIGNED_INT_10F_11F_11F_REV:
    case GL.UNSIGNED_INT_5_9_9_9_REV:
    case GL.UNSIGNED_INT_24_8:
      return { bytes: 4, packed: true };
    case GL.FLOAT_32_UNSIGNED_INT_24_8_REV:
      return { bytes: 8, packed: true };
    default:
      return { bytes: 4, packed: false };
  }
};

const componentCount = (format: number): number => {
  switch (format) {
    case GL.RGBA:
    case GL.RGBA_INTEGER:
      return 4;
    case GL.RGB:
    case GL.RGB_INTEGER:
      return 3;
    case GL.RG:
    case GL.RG_INTEGER:
    case GL.LUMINANCE_ALPHA:
    case GL.DEPTH_STENCIL:
      return 2;
    default:
      return 1;
  }
};

/** Bytes per pixel of a format and type. */
export const pixelSize = (format: number, type: number): number => {
  const { bytes, packed } = typeSize(type);
  return packed ? bytes : bytes * componentCount(format);
};

const alignUp = (value: number, alignment: number): number =>
  Math.ceil(value / alignment) * alignment;

const isTypedArray = (value: unknown): value is TypedArray =>
  ArrayBuffer.isView(value) && !(value instanceof DataView);

/**
 * `<canvas>`'s `getContext('webgl2')` on Lynx: the WebGL2RenderingContext API
 * three.js and other WebGL libraries draw with, run on the shell's OpenGL ES
 * 3.0 through the `AngularLynxWebGL` module (see webgl-bridge.ts).
 *
 * Calls that return nothing are recorded, not sent: `run` sends them all at
 * once at the end of the task (a microtask), when a call needs an answer from
 * the driver, or when many have piled up. So a frame of three.js, a few
 * hundred calls, costs one bridge call. Calls that need an answer send the
 * recorded ones first, so the driver sees everything in order.
 *
 * Most answers don't need the driver at all:
 * - The limits (every `MAX_*` parameter and the like), the shader precisions
 *   and the extensions are fetched in one call when the context is made.
 * - Bindings (`getParameter(ARRAY_BUFFER_BINDING)` and the rest) are kept
 *   here, as the objects the app passed, which the driver can't give back.
 * - A program's link status, log, active uniforms and attributes and their
 *   locations come in one call after each link (`programInfo`): three.js asks
 *   for each of them for every program it builds.
 *
 * What WebGL adds to GLES, the context or the shell adds:
 * - The default framebuffer (`bindFramebuffer(FRAMEBUFFER, null)`) is an
 *   offscreen framebuffer the shell made at the canvas's `width` and
 *   `height`, which it copies to the screen after each frame that drew to it
 *   (the `present` command, sent when a task drew to it).
 * - UNPACK_FLIP_Y_WEBGL and UNPACK_PREMULTIPLY_ALPHA_WEBGL: the shell flips
 *   and premultiplies an image's pixels as it uploads them, and the context
 *   does it to typed-array data before sending it.
 * - Images: `texImage2D` with an ImageBitmap or an `<img>` uploads pixels the
 *   shell decoded and kept (see image.ts), by id.
 *
 * Not there: context loss and restore (only `WEBGL_lose_context`'s loss,
 * which three.js calls on dispose), a `<canvas>` or video as a texture
 * source, and object answers from `getVertexAttrib` and `getIndexedParameter`
 * (they return null).
 */
// The interface below adds the constants, which Object.assign puts on the
// prototype: they're there at runtime, which is what the rule worries about.
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- the merged constants are assigned to the prototype below
export class LynxWebGL2RenderingContext {
  readonly canvas: WebGLCanvasHost;
  /** three.js sets these from `outputColorSpace`; the shell draws in sRGB. */
  drawingBufferColorSpace: string = 'srgb';
  unpackColorSpace: string = 'srgb';

  readonly #bridge: WebGLBridge;
  readonly #id: number;
  readonly #attributes: LynxWebGLContextAttributes;
  #commands: unknown[] = [];
  #flushScheduled = false;
  /** The default framebuffer was drawn to since the last present. */
  #dirty = false;
  #lost = false;
  /** An error the context found itself, which getError() reports first. */
  #error = 0;
  #nextObjectId = 1;
  #drawingBufferWidth = 0;
  #drawingBufferHeight = 0;

  readonly #parameters = new Map<number, unknown>();
  readonly #precisions = new Map<string, LynxWebGLShaderPrecisionFormat>();
  readonly #supportedExtensions: string[];
  readonly #extensions = new Map<string, object | null>();

  // Bindings, which getParameter() answers from.
  #arrayBuffer: LynxWebGLBuffer | null = null;
  #copyReadBuffer: LynxWebGLBuffer | null = null;
  #copyWriteBuffer: LynxWebGLBuffer | null = null;
  #pixelPackBuffer: LynxWebGLBuffer | null = null;
  #pixelUnpackBuffer: LynxWebGLBuffer | null = null;
  #uniformBuffer: LynxWebGLBuffer | null = null;
  #transformFeedbackBuffer: LynxWebGLBuffer | null = null;
  #drawFramebuffer: LynxWebGLFramebuffer | null = null;
  #readFramebuffer: LynxWebGLFramebuffer | null = null;
  #renderbuffer: LynxWebGLRenderbuffer | null = null;
  #program: LynxWebGLProgram | null = null;
  #transformFeedback: LynxWebGLTransformFeedback | null = null;
  /** The default vertex array, which holds the element buffer when none is bound. */
  readonly #defaultVertexArray: LynxWebGLVertexArrayObject;
  #vertexArray: LynxWebGLVertexArrayObject | null = null;
  #activeTexture = 0;
  readonly #textures: Map<number, LynxWebGLTexture | null>[] = [];
  readonly #samplers: (LynxWebGLSampler | null)[] = [];
  readonly #queries = new Map<number, LynxWebGLQuery | null>();
  /** Framebuffer attachments, for FRAMEBUFFER_ATTACHMENT_OBJECT_NAME. */
  readonly #attachments = new WeakMap<
    LynxWebGLFramebuffer,
    Map<number, WebGLObjectHandle | null>
  >();

  // Pixel storage the context applies or needs itself.
  #flipY = false;
  #premultiplyAlpha = false;
  #colorspaceConversion: number = GL.BROWSER_DEFAULT_WEBGL;
  #unpackAlignment = 4;
  readonly #pack = { alignment: 4, rowLength: 0, skipPixels: 0, skipRows: 0 };

  constructor(
    bridge: WebGLBridge,
    contextId: number,
    canvas: WebGLCanvasHost,
    attributes: LynxWebGLContextAttributes,
  ) {
    this.#bridge = bridge;
    this.#id = contextId;
    this.canvas = canvas;
    this.#attributes = attributes;
    this.#defaultVertexArray = new LynxWebGLVertexArrayObject(0, this);
    this.#drawingBufferWidth = canvas.width;
    this.#drawingBufferHeight = canvas.height;

    // The drawing buffer, and everything that never changes, in one call.
    const queries: unknown[] = [OP.resize, canvas.width, canvas.height];
    for (const pname of CONSTANT_PARAMETERS) {
      queries.push(OP.getParameter, pname);
    }
    for (const shaderType of SHADER_TYPES) {
      for (const precisionType of PRECISION_TYPES) {
        queries.push(OP.getShaderPrecisionFormat, shaderType, precisionType);
      }
    }
    queries.push(OP.getSupportedExtensions);
    // A limit this driver doesn't know (an extension's) sets an error the app
    // didn't cause: clear it.
    queries.push(OP.getError);
    const results = bridge.run(contextId, queries);
    let index = 0;
    for (const pname of CONSTANT_PARAMETERS) {
      this.#parameters.set(
        pname,
        this.#parameterValue(pname, results[index++]),
      );
    }
    for (const shaderType of SHADER_TYPES) {
      for (const precisionType of PRECISION_TYPES) {
        const [rangeMin = 0, rangeMax = 0, precision = 0] = numbersFrom(
          results[index++],
        );
        this.#precisions.set(
          `${shaderType}:${precisionType}`,
          new LynxWebGLShaderPrecisionFormat(rangeMin, rangeMax, precision),
        );
      }
    }
    const glExtensions = new Set((results[index++] as string[]) ?? []);
    this.#supportedExtensions = [
      ...Object.entries(EXTENSIONS_FROM_GL)
        .filter(([, names]) => names.some((name) => glExtensions.has(name)))
        .map(([webglName]) => webglName),
      ...ALWAYS_EXTENSIONS,
    ].sort();
  }

  /**
   * --- The batch -----------------------------------------------------------
   */

  #cmd(...items: unknown[]): void {
    if (this.#lost) return;
    for (const item of items) this.#commands.push(item);
    this.#scheduleFlush();
  }

  /**
   * Records a command that draws: to the screen when no framebuffer is bound.
   */
  #draw(...items: unknown[]): void {
    if (!this.#drawFramebuffer) this.#dirty = true;
    this.#cmd(...items);
  }

  #scheduleFlush(): void {
    if (this.#commands.length > 65536) {
      // A big upload or a long loop: send what's there before it grows more.
      this.#send();
      return;
    }
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    queueMicrotask(() => this.#endOfTask());
  }

  /**
   * At the end of the task that drew, as a browser composites a canvas after
   * the task that drew to it: send the calls, and show the frame.
   */
  #endOfTask(): void {
    this.#flushScheduled = false;
    if (this.#lost) return;
    if (this.#dirty) {
      this.#dirty = false;
      this.#commands.push(OP.present);
    }
    this.#send();
  }

  #send(): unknown[] {
    if (this.#commands.length === 0) return [];
    const commands = this.#commands;
    this.#commands = [];
    return this.#bridge.run(this.#id, commands);
  }

  /**
   * Sends the recorded calls and one query, and returns its answer.
   */
  #query(...items: unknown[]): unknown {
    if (this.#lost) return null;
    for (const item of items) this.#commands.push(item);
    const results = this.#send();
    return results[results.length - 1] ?? null;
  }

  #fail(error: number): void {
    if (this.#error === 0) this.#error = error;
  }

  #nextId(): number {
    return this.#nextObjectId++;
  }

  #owns(object: WebGLObjectHandle | null | undefined): boolean {
    return !!object && object.owner === this;
  }

  #idOf(object: WebGLObjectHandle | null | undefined): number {
    if (!object) return 0;
    if (object.owner !== this) {
      this.#fail(GL.INVALID_OPERATION);
      return 0;
    }
    return object.id;
  }

  /**
   * --- The context ---------------------------------------------------------
   */

  get drawingBufferWidth(): number {
    return this.#drawingBufferWidth;
  }

  get drawingBufferHeight(): number {
    return this.#drawingBufferHeight;
  }

  /**
   * @internal The canvas's width or height changed.
   */
  resize(width: number, height: number): void {
    const maxSize =
      (this.#parameters.get(GL.MAX_RENDERBUFFER_SIZE) as number | undefined) ??
      4096;
    this.#drawingBufferWidth = Math.max(1, Math.min(width, maxSize));
    this.#drawingBufferHeight = Math.max(1, Math.min(height, maxSize));
    this.#cmd(OP.resize, this.#drawingBufferWidth, this.#drawingBufferHeight);
  }

  /**
   * @internal The canvas left the page for good: free the GL context.
   */
  destroy(): void {
    if (this.#lost) return;
    this.#lost = true;
    this.#commands = [];
    this.#bridge.destroy(this.#id);
  }

  /**
   * @internal The drawing buffer as a PNG or JPEG file, for the canvas's
   * toBlob() and toDataURL(). The recorded calls go first, so the file holds
   * what the app drew up to now. A frame it hasn't shown yet is still in the
   * drawing buffer, as in a browser, where toBlob() in the task that drew
   * reads what it drew.
   */
  encodeDrawingBuffer(type: string, quality: number): EncodedImage {
    if (this.#lost) return { error: 'The WebGL context is lost' };
    this.#send();
    return this.#bridge.encodeImage(this.#id, {
      type,
      quality,
      premultipliedAlpha: this.#attributes.premultipliedAlpha,
    });
  }

  getContextAttributes(): LynxWebGLContextAttributes | null {
    return this.#lost ? null : { ...this.#attributes };
  }

  isContextLost(): boolean {
    return this.#lost;
  }

  makeXRCompatible(): Promise<void> {
    return Promise.reject(new Error('WebXR is not available on Lynx'));
  }

  getSupportedExtensions(): string[] | null {
    return this.#lost ? null : [...this.#supportedExtensions];
  }

  getExtension(name: string): object | null {
    if (this.#lost) return null;
    const known = this.#supportedExtensions.find(
      (supported) => supported.toLowerCase() === name.toLowerCase(),
    );
    if (!known) return null;
    let extension = this.#extensions.get(known);
    if (extension === undefined) {
      extension =
        known === 'WEBGL_lose_context'
          ? {
              loseContext: () => this.#loseContext(),
              restoreContext: () => this.#fail(GL.INVALID_OPERATION),
            }
          : known === 'WEBGL_compressed_texture_astc'
            ? {
                ...EXTENSION_CONSTANTS[known],
                getSupportedProfiles: () => ['ldr'],
              }
            : { ...EXTENSION_CONSTANTS[known] };
      this.#extensions.set(known, extension);
    }
    return extension;
  }

  #loseContext(): void {
    if (this.#lost) return;
    this.destroy();
    this.#error = GL.CONTEXT_LOST_WEBGL;
    this.canvas.dispatchContextEvent('webglcontextlost');
  }

  getError(): number {
    if (this.#error !== 0) {
      const error = this.#error;
      this.#error = 0;
      return error;
    }
    if (this.#lost) return GL.NO_ERROR;
    return (this.#query(OP.getError) as number) ?? GL.NO_ERROR;
  }

  /**
   * --- State ---------------------------------------------------------------
   */

  getParameter(pname: number): unknown {
    if (this.#lost) return null;
    switch (pname) {
      case GL.VERSION:
        return 'WebGL 2.0 (OpenGL ES 3.0 Lynx)';
      case GL.SHADING_LANGUAGE_VERSION:
        return 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Lynx)';
      case GL.VENDOR:
        return 'AngularLynx';
      case GL.RENDERER:
        return 'AngularLynx WebGL';
      case GL.ARRAY_BUFFER_BINDING:
        return this.#arrayBuffer;
      case GL.ELEMENT_ARRAY_BUFFER_BINDING:
        return (this.#vertexArray ?? this.#defaultVertexArray)
          .elementArrayBuffer;
      case GL.COPY_READ_BUFFER_BINDING:
        return this.#copyReadBuffer;
      case GL.COPY_WRITE_BUFFER_BINDING:
        return this.#copyWriteBuffer;
      case GL.PIXEL_PACK_BUFFER_BINDING:
        return this.#pixelPackBuffer;
      case GL.PIXEL_UNPACK_BUFFER_BINDING:
        return this.#pixelUnpackBuffer;
      case GL.UNIFORM_BUFFER_BINDING:
        return this.#uniformBuffer;
      case GL.TRANSFORM_FEEDBACK_BUFFER_BINDING:
        return this.#transformFeedbackBuffer;
      case GL.FRAMEBUFFER_BINDING:
        return this.#drawFramebuffer;
      case GL.READ_FRAMEBUFFER_BINDING:
        return this.#readFramebuffer;
      case GL.RENDERBUFFER_BINDING:
        return this.#renderbuffer;
      case GL.CURRENT_PROGRAM:
        return this.#program;
      case GL.VERTEX_ARRAY_BINDING:
        return this.#vertexArray;
      case GL.TRANSFORM_FEEDBACK_BINDING:
        return this.#transformFeedback;
      case GL.ACTIVE_TEXTURE:
        return GL.TEXTURE0 + this.#activeTexture;
      case GL.TEXTURE_BINDING_2D:
        return this.#textureBinding(GL.TEXTURE_2D);
      case GL.TEXTURE_BINDING_CUBE_MAP:
        return this.#textureBinding(GL.TEXTURE_CUBE_MAP);
      case GL.TEXTURE_BINDING_3D:
        return this.#textureBinding(GL.TEXTURE_3D);
      case GL.TEXTURE_BINDING_2D_ARRAY:
        return this.#textureBinding(GL.TEXTURE_2D_ARRAY);
      case GL.SAMPLER_BINDING:
        return this.#samplers[this.#activeTexture] ?? null;
      case UNPACK_FLIP_Y_WEBGL:
        return this.#flipY;
      case UNPACK_PREMULTIPLY_ALPHA_WEBGL:
        return this.#premultiplyAlpha;
      case UNPACK_COLORSPACE_CONVERSION_WEBGL:
        return this.#colorspaceConversion;
      case GL.MAX_CLIENT_WAIT_TIMEOUT_WEBGL:
        // clientWaitSync can't block the thread Angular and Lynx run on.
        return 0;
    }
    if (this.#parameters.has(pname)) {
      const value = this.#parameters.get(pname);
      return ArrayBuffer.isView(value) ? (value as TypedArray).slice() : value;
    }
    if (
      pname === MAX_TEXTURE_MAX_ANISOTROPY_EXT &&
      !this.#supportedExtensions.includes('EXT_texture_filter_anisotropic')
    ) {
      this.#fail(GL.INVALID_ENUM);
      return null;
    }
    return this.#parameterValue(pname, this.#query(OP.getParameter, pname));
  }

  /**
   * The driver's answer as WebGL types it.
   */
  #parameterValue(pname: number, value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (FLOAT_VECTOR_PARAMETERS.has(pname)) {
      return new Float32Array(numbersFrom(value));
    }
    if (INT_VECTOR_PARAMETERS.has(pname)) {
      return new Int32Array(numbersFrom(value));
    }
    if (pname === GL.COMPRESSED_TEXTURE_FORMATS) {
      return new Uint32Array(numbersFrom(value));
    }
    if (pname === GL.COLOR_WRITEMASK) {
      return numbersFrom(value).map(Boolean);
    }
    if (BOOLEAN_PARAMETERS.has(pname)) return Boolean(value);
    return value;
  }

  #textureBinding(target: number): LynxWebGLTexture | null {
    return this.#textures[this.#activeTexture]?.get(target) ?? null;
  }

  isEnabled(cap: number): boolean {
    return Boolean(this.#query(OP.isEnabled, cap));
  }

  enable(cap: number): void {
    this.#cmd(OP.enable, cap);
  }

  disable(cap: number): void {
    this.#cmd(OP.disable, cap);
  }

  activeTexture(texture: number): void {
    this.#activeTexture = texture - GL.TEXTURE0;
    this.#cmd(OP.activeTexture, texture);
  }

  blendColor(red: number, green: number, blue: number, alpha: number): void {
    this.#cmd(OP.blendColor, red, green, blue, alpha);
  }

  blendEquation(mode: number): void {
    this.#cmd(OP.blendEquation, mode);
  }

  blendEquationSeparate(modeRGB: number, modeAlpha: number): void {
    this.#cmd(OP.blendEquationSeparate, modeRGB, modeAlpha);
  }

  blendFunc(sfactor: number, dfactor: number): void {
    this.#cmd(OP.blendFunc, sfactor, dfactor);
  }

  blendFuncSeparate(
    srcRGB: number,
    dstRGB: number,
    srcAlpha: number,
    dstAlpha: number,
  ): void {
    this.#cmd(OP.blendFuncSeparate, srcRGB, dstRGB, srcAlpha, dstAlpha);
  }

  clearColor(red: number, green: number, blue: number, alpha: number): void {
    this.#cmd(OP.clearColor, red, green, blue, alpha);
  }

  clearDepth(depth: number): void {
    this.#cmd(OP.clearDepth, depth);
  }

  clearStencil(s: number): void {
    this.#cmd(OP.clearStencil, s);
  }

  colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void {
    this.#cmd(OP.colorMask, +red, +green, +blue, +alpha);
  }

  cullFace(mode: number): void {
    this.#cmd(OP.cullFace, mode);
  }

  depthFunc(func: number): void {
    this.#cmd(OP.depthFunc, func);
  }

  depthMask(flag: boolean): void {
    this.#cmd(OP.depthMask, +flag);
  }

  depthRange(zNear: number, zFar: number): void {
    this.#cmd(OP.depthRange, zNear, zFar);
  }

  frontFace(mode: number): void {
    this.#cmd(OP.frontFace, mode);
  }

  hint(target: number, mode: number): void {
    this.#cmd(OP.hint, target, mode);
  }

  lineWidth(width: number): void {
    this.#cmd(OP.lineWidth, width);
  }

  pixelStorei(pname: number, param: number | boolean): void {
    switch (pname) {
      case UNPACK_FLIP_Y_WEBGL:
        this.#flipY = Boolean(param);
        return;
      case UNPACK_PREMULTIPLY_ALPHA_WEBGL:
        this.#premultiplyAlpha = Boolean(param);
        return;
      case UNPACK_COLORSPACE_CONVERSION_WEBGL:
        // The shell decodes images to sRGB bytes either way.
        this.#colorspaceConversion = Number(param);
        return;
      case GL.UNPACK_ALIGNMENT:
        this.#unpackAlignment = Number(param);
        break;
      case GL.PACK_ALIGNMENT:
        this.#pack.alignment = Number(param);
        break;
      case GL.PACK_ROW_LENGTH:
        this.#pack.rowLength = Number(param);
        break;
      case GL.PACK_SKIP_PIXELS:
        this.#pack.skipPixels = Number(param);
        break;
      case GL.PACK_SKIP_ROWS:
        this.#pack.skipRows = Number(param);
        break;
    }
    this.#cmd(OP.pixelStorei, pname, Number(param));
  }

  polygonOffset(factor: number, units: number): void {
    this.#cmd(OP.polygonOffset, factor, units);
  }

  sampleCoverage(value: number, invert: boolean): void {
    this.#cmd(OP.sampleCoverage, value, +invert);
  }

  scissor(x: number, y: number, width: number, height: number): void {
    this.#cmd(OP.scissor, x, y, width, height);
  }

  stencilFunc(func: number, ref: number, mask: number): void {
    this.#cmd(OP.stencilFunc, func, ref, mask >>> 0);
  }

  stencilFuncSeparate(
    face: number,
    func: number,
    ref: number,
    mask: number,
  ): void {
    this.#cmd(OP.stencilFuncSeparate, face, func, ref, mask >>> 0);
  }

  stencilMask(mask: number): void {
    this.#cmd(OP.stencilMask, mask >>> 0);
  }

  stencilMaskSeparate(face: number, mask: number): void {
    this.#cmd(OP.stencilMaskSeparate, face, mask >>> 0);
  }

  stencilOp(fail: number, zfail: number, zpass: number): void {
    this.#cmd(OP.stencilOp, fail, zfail, zpass);
  }

  stencilOpSeparate(
    face: number,
    fail: number,
    zfail: number,
    zpass: number,
  ): void {
    this.#cmd(OP.stencilOpSeparate, face, fail, zfail, zpass);
  }

  viewport(x: number, y: number, width: number, height: number): void {
    this.#cmd(OP.viewport, x, y, width, height);
  }

  getShaderPrecisionFormat(
    shadertype: number,
    precisiontype: number,
  ): LynxWebGLShaderPrecisionFormat | null {
    return this.#precisions.get(`${shadertype}:${precisiontype}`) ?? null;
  }

  /**
   * --- Buffers -------------------------------------------------------------
   */

  createBuffer(): LynxWebGLBuffer {
    const buffer = new LynxWebGLBuffer(this.#nextId(), this);
    this.#cmd(OP.createBuffer, buffer.id);
    return buffer;
  }

  deleteBuffer(buffer: LynxWebGLBuffer | null): void {
    if (!this.#owns(buffer) || buffer!.deleted) return;
    buffer!.deleted = true;
    for (const key of [
      'arrayBuffer',
      'copyReadBuffer',
      'copyWriteBuffer',
      'pixelPackBuffer',
      'pixelUnpackBuffer',
      'uniformBuffer',
      'transformFeedbackBuffer',
    ] as const) {
      this.#unbindBuffer(key, buffer!);
    }
    const vertexArray = this.#vertexArray ?? this.#defaultVertexArray;
    if (vertexArray.elementArrayBuffer === buffer) {
      vertexArray.elementArrayBuffer = null;
    }
    this.#cmd(OP.deleteBuffer, buffer!.id);
  }

  #unbindBuffer(
    key:
      | 'arrayBuffer'
      | 'copyReadBuffer'
      | 'copyWriteBuffer'
      | 'pixelPackBuffer'
      | 'pixelUnpackBuffer'
      | 'uniformBuffer'
      | 'transformFeedbackBuffer',
    buffer: LynxWebGLBuffer,
  ): void {
    switch (key) {
      case 'arrayBuffer':
        if (this.#arrayBuffer === buffer) this.#arrayBuffer = null;
        break;
      case 'copyReadBuffer':
        if (this.#copyReadBuffer === buffer) this.#copyReadBuffer = null;
        break;
      case 'copyWriteBuffer':
        if (this.#copyWriteBuffer === buffer) this.#copyWriteBuffer = null;
        break;
      case 'pixelPackBuffer':
        if (this.#pixelPackBuffer === buffer) this.#pixelPackBuffer = null;
        break;
      case 'pixelUnpackBuffer':
        if (this.#pixelUnpackBuffer === buffer) this.#pixelUnpackBuffer = null;
        break;
      case 'uniformBuffer':
        if (this.#uniformBuffer === buffer) this.#uniformBuffer = null;
        break;
      case 'transformFeedbackBuffer':
        if (this.#transformFeedbackBuffer === buffer) {
          this.#transformFeedbackBuffer = null;
        }
        break;
    }
  }

  isBuffer(buffer: LynxWebGLBuffer | null): boolean {
    return this.#isLive(buffer);
  }

  #isLive(object: WebGLObjectHandle | null): boolean {
    return !this.#lost && this.#owns(object) && !object!.deleted;
  }

  bindBuffer(target: number, buffer: LynxWebGLBuffer | null): void {
    this.#trackBuffer(target, buffer);
    this.#cmd(OP.bindBuffer, target, this.#idOf(buffer));
  }

  #trackBuffer(target: number, buffer: LynxWebGLBuffer | null): void {
    switch (target) {
      case GL.ARRAY_BUFFER:
        this.#arrayBuffer = buffer;
        break;
      case GL.ELEMENT_ARRAY_BUFFER:
        (this.#vertexArray ?? this.#defaultVertexArray).elementArrayBuffer =
          buffer;
        break;
      case GL.COPY_READ_BUFFER:
        this.#copyReadBuffer = buffer;
        break;
      case GL.COPY_WRITE_BUFFER:
        this.#copyWriteBuffer = buffer;
        break;
      case GL.PIXEL_PACK_BUFFER:
        this.#pixelPackBuffer = buffer;
        break;
      case GL.PIXEL_UNPACK_BUFFER:
        this.#pixelUnpackBuffer = buffer;
        break;
      case GL.UNIFORM_BUFFER:
        this.#uniformBuffer = buffer;
        break;
      case GL.TRANSFORM_FEEDBACK_BUFFER:
        this.#transformFeedbackBuffer = buffer;
        break;
    }
  }

  bindBufferBase(
    target: number,
    index: number,
    buffer: LynxWebGLBuffer | null,
  ): void {
    this.#trackBuffer(target, buffer);
    this.#cmd(OP.bindBufferBase, target, index, this.#idOf(buffer));
  }

  bindBufferRange(
    target: number,
    index: number,
    buffer: LynxWebGLBuffer | null,
    offset: number,
    size: number,
  ): void {
    this.#trackBuffer(target, buffer);
    this.#cmd(
      OP.bindBufferRange,
      target,
      index,
      this.#idOf(buffer),
      offset,
      size,
    );
  }

  bufferData(
    target: number,
    sizeOrData: number | ArrayBufferView | ArrayBuffer | null,
    usage: number,
    srcOffset = 0,
    length = 0,
  ): void {
    let data: unknown;
    if (typeof sizeOrData === 'number') {
      data = sizeOrData;
    } else if (sizeOrData === null) {
      data = 0;
    } else {
      data = toWords(bytesOf(sizeOrData, srcOffset, length || undefined));
    }
    this.#cmd(OP.bufferData, target, data, usage);
  }

  bufferSubData(
    target: number,
    dstByteOffset: number,
    srcData: ArrayBufferView | ArrayBuffer,
    srcOffset = 0,
    length = 0,
  ): void {
    this.#cmd(
      OP.bufferSubData,
      target,
      dstByteOffset,
      toWords(bytesOf(srcData, srcOffset, length || undefined)),
    );
  }

  copyBufferSubData(
    readTarget: number,
    writeTarget: number,
    readOffset: number,
    writeOffset: number,
    size: number,
  ): void {
    this.#cmd(
      OP.copyBufferSubData,
      readTarget,
      writeTarget,
      readOffset,
      writeOffset,
      size,
    );
  }

  getBufferParameter(target: number, pname: number): unknown {
    return this.#query(OP.getBufferParameter, target, pname);
  }

  getBufferSubData(
    target: number,
    srcByteOffset: number,
    dstBuffer: ArrayBufferView,
    dstOffset = 0,
    length = 0,
  ): void {
    const destination = bytesOf(dstBuffer, dstOffset, length || undefined);
    const words = this.#query(
      OP.getBufferSubData,
      target,
      srcByteOffset,
      destination.byteLength,
    ) as number[] | null;
    if (words) destination.set(fromWords(words));
  }

  /**
   * --- Vertex arrays and attributes ---------------------------------------
   */

  createVertexArray(): LynxWebGLVertexArrayObject {
    const vertexArray = new LynxWebGLVertexArrayObject(this.#nextId(), this);
    this.#cmd(OP.createVertexArray, vertexArray.id);
    return vertexArray;
  }

  deleteVertexArray(vertexArray: LynxWebGLVertexArrayObject | null): void {
    if (!this.#owns(vertexArray) || vertexArray!.deleted) return;
    vertexArray!.deleted = true;
    if (this.#vertexArray === vertexArray) this.#vertexArray = null;
    this.#cmd(OP.deleteVertexArray, vertexArray!.id);
  }

  isVertexArray(vertexArray: LynxWebGLVertexArrayObject | null): boolean {
    return this.#isLive(vertexArray);
  }

  bindVertexArray(vertexArray: LynxWebGLVertexArrayObject | null): void {
    this.#vertexArray = vertexArray;
    this.#cmd(OP.bindVertexArray, this.#idOf(vertexArray));
  }

  enableVertexAttribArray(index: number): void {
    this.#cmd(OP.enableVertexAttribArray, index);
  }

  disableVertexAttribArray(index: number): void {
    this.#cmd(OP.disableVertexAttribArray, index);
  }

  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void {
    this.#cmd(
      OP.vertexAttribPointer,
      index,
      size,
      type,
      +normalized,
      stride,
      offset,
    );
  }

  vertexAttribIPointer(
    index: number,
    size: number,
    type: number,
    stride: number,
    offset: number,
  ): void {
    this.#cmd(OP.vertexAttribIPointer, index, size, type, stride, offset);
  }

  vertexAttribDivisor(index: number, divisor: number): void {
    this.#cmd(OP.vertexAttribDivisor, index, divisor);
  }

  vertexAttrib1f(index: number, x: number): void {
    this.#cmd(OP.vertexAttrib4f, index, x, 0, 0, 1);
  }

  vertexAttrib2f(index: number, x: number, y: number): void {
    this.#cmd(OP.vertexAttrib4f, index, x, y, 0, 1);
  }

  vertexAttrib3f(index: number, x: number, y: number, z: number): void {
    this.#cmd(OP.vertexAttrib4f, index, x, y, z, 1);
  }

  vertexAttrib4f(
    index: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.#cmd(OP.vertexAttrib4f, index, x, y, z, w);
  }

  vertexAttrib1fv(index: number, values: ArrayLike<number>): void {
    this.vertexAttrib1f(index, values[0]);
  }

  vertexAttrib2fv(index: number, values: ArrayLike<number>): void {
    this.vertexAttrib2f(index, values[0], values[1]);
  }

  vertexAttrib3fv(index: number, values: ArrayLike<number>): void {
    this.vertexAttrib3f(index, values[0], values[1], values[2]);
  }

  vertexAttrib4fv(index: number, values: ArrayLike<number>): void {
    this.vertexAttrib4f(index, values[0], values[1], values[2], values[3]);
  }

  vertexAttribI4i(
    index: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.#cmd(OP.vertexAttribI4i, index, x, y, z, w);
  }

  vertexAttribI4iv(index: number, values: ArrayLike<number>): void {
    this.vertexAttribI4i(index, values[0], values[1], values[2], values[3]);
  }

  vertexAttribI4ui(
    index: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.#cmd(OP.vertexAttribI4ui, index, x, y, z, w);
  }

  vertexAttribI4uiv(index: number, values: ArrayLike<number>): void {
    this.vertexAttribI4ui(index, values[0], values[1], values[2], values[3]);
  }

  getVertexAttrib(index: number, pname: number): unknown {
    if (pname === GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) return null;
    const value = this.#query(OP.getVertexAttrib, index, pname);
    if (pname === GL.CURRENT_VERTEX_ATTRIB) {
      return new Float32Array(value ? numbersFrom(value) : [0, 0, 0, 1]);
    }
    if (
      pname === GL.VERTEX_ATTRIB_ARRAY_ENABLED ||
      pname === GL.VERTEX_ATTRIB_ARRAY_NORMALIZED ||
      pname === GL.VERTEX_ATTRIB_ARRAY_INTEGER
    ) {
      return Boolean(value);
    }
    return value;
  }

  getVertexAttribOffset(index: number, pname: number): number {
    return (this.#query(OP.getVertexAttribOffset, index, pname) as number) ?? 0;
  }

  /**
   * --- Drawing -------------------------------------------------------------
   */

  clear(mask: number): void {
    this.#draw(OP.clear, mask);
  }

  clearBufferfv(
    buffer: number,
    drawbuffer: number,
    values: NumberList,
    srcOffset = 0,
  ): void {
    this.#draw(
      OP.clearBufferfv,
      buffer,
      drawbuffer,
      numbers(values, srcOffset, 0),
    );
  }

  clearBufferiv(
    buffer: number,
    drawbuffer: number,
    values: NumberList,
    srcOffset = 0,
  ): void {
    this.#draw(
      OP.clearBufferiv,
      buffer,
      drawbuffer,
      numbers(values, srcOffset, 0),
    );
  }

  clearBufferuiv(
    buffer: number,
    drawbuffer: number,
    values: NumberList,
    srcOffset = 0,
  ): void {
    this.#draw(
      OP.clearBufferuiv,
      buffer,
      drawbuffer,
      numbers(values, srcOffset, 0),
    );
  }

  clearBufferfi(
    buffer: number,
    drawbuffer: number,
    depth: number,
    stencil: number,
  ): void {
    this.#draw(OP.clearBufferfi, buffer, drawbuffer, depth, stencil);
  }

  drawArrays(mode: number, first: number, count: number): void {
    this.#draw(OP.drawArrays, mode, first, count);
  }

  drawArraysInstanced(
    mode: number,
    first: number,
    count: number,
    instanceCount: number,
  ): void {
    this.#draw(OP.drawArraysInstanced, mode, first, count, instanceCount);
  }

  drawElements(
    mode: number,
    count: number,
    type: number,
    offset: number,
  ): void {
    this.#draw(OP.drawElements, mode, count, type, offset);
  }

  drawElementsInstanced(
    mode: number,
    count: number,
    type: number,
    offset: number,
    instanceCount: number,
  ): void {
    this.#draw(
      OP.drawElementsInstanced,
      mode,
      count,
      type,
      offset,
      instanceCount,
    );
  }

  drawRangeElements(
    mode: number,
    start: number,
    end: number,
    count: number,
    type: number,
    offset: number,
  ): void {
    this.#draw(OP.drawRangeElements, mode, start, end, count, type, offset);
  }

  drawBuffers(buffers: ArrayLike<number>): void {
    this.#cmd(OP.drawBuffers, Array.from(buffers));
  }

  readBuffer(src: number): void {
    this.#cmd(OP.readBuffer, src);
  }

  finish(): void {
    // Wait for the GL: the batch goes now, and the shell calls glFinish.
    this.#cmd(OP.finish);
    this.#send();
  }

  flush(): void {
    this.#cmd(OP.flush);
    this.#send();
  }

  /**
   * --- Framebuffers and renderbuffers -------------------------------------
   */

  createFramebuffer(): LynxWebGLFramebuffer {
    const framebuffer = new LynxWebGLFramebuffer(this.#nextId(), this);
    this.#cmd(OP.createFramebuffer, framebuffer.id);
    return framebuffer;
  }

  deleteFramebuffer(framebuffer: LynxWebGLFramebuffer | null): void {
    if (!this.#owns(framebuffer) || framebuffer!.deleted) return;
    framebuffer!.deleted = true;
    if (this.#drawFramebuffer === framebuffer) this.#drawFramebuffer = null;
    if (this.#readFramebuffer === framebuffer) this.#readFramebuffer = null;
    this.#cmd(OP.deleteFramebuffer, framebuffer!.id);
  }

  isFramebuffer(framebuffer: LynxWebGLFramebuffer | null): boolean {
    return this.#isLive(framebuffer);
  }

  bindFramebuffer(
    target: number,
    framebuffer: LynxWebGLFramebuffer | null,
  ): void {
    if (target === GL.FRAMEBUFFER || target === GL.DRAW_FRAMEBUFFER) {
      this.#drawFramebuffer = framebuffer;
    }
    if (target === GL.FRAMEBUFFER || target === GL.READ_FRAMEBUFFER) {
      this.#readFramebuffer = framebuffer;
    }
    this.#cmd(OP.bindFramebuffer, target, this.#idOf(framebuffer));
  }

  #boundFramebuffer(target: number): LynxWebGLFramebuffer | null {
    return target === GL.READ_FRAMEBUFFER
      ? this.#readFramebuffer
      : this.#drawFramebuffer;
  }

  #attach(
    target: number,
    attachment: number,
    object: WebGLObjectHandle | null,
  ): void {
    const framebuffer = this.#boundFramebuffer(target);
    if (!framebuffer) return;
    let attachments = this.#attachments.get(framebuffer);
    if (!attachments) {
      attachments = new Map();
      this.#attachments.set(framebuffer, attachments);
    }
    if (attachment === GL.DEPTH_STENCIL_ATTACHMENT) {
      attachments.set(GL.DEPTH_ATTACHMENT, object);
      attachments.set(GL.STENCIL_ATTACHMENT, object);
    } else {
      attachments.set(attachment, object);
    }
  }

  framebufferRenderbuffer(
    target: number,
    attachment: number,
    renderbuffertarget: number,
    renderbuffer: LynxWebGLRenderbuffer | null,
  ): void {
    this.#attach(target, attachment, renderbuffer);
    this.#cmd(
      OP.framebufferRenderbuffer,
      target,
      attachment,
      renderbuffertarget,
      this.#idOf(renderbuffer),
    );
  }

  framebufferTexture2D(
    target: number,
    attachment: number,
    textarget: number,
    texture: LynxWebGLTexture | null,
    level: number,
  ): void {
    this.#attach(target, attachment, texture);
    this.#cmd(
      OP.framebufferTexture2D,
      target,
      attachment,
      textarget,
      this.#idOf(texture),
      level,
    );
  }

  framebufferTextureLayer(
    target: number,
    attachment: number,
    texture: LynxWebGLTexture | null,
    level: number,
    layer: number,
  ): void {
    this.#attach(target, attachment, texture);
    this.#cmd(
      OP.framebufferTextureLayer,
      target,
      attachment,
      this.#idOf(texture),
      level,
      layer,
    );
  }

  checkFramebufferStatus(target: number): number {
    return (this.#query(OP.checkFramebufferStatus, target) as number) ?? 0;
  }

  getFramebufferAttachmentParameter(
    target: number,
    attachment: number,
    pname: number,
  ): unknown {
    if (pname === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) {
      const framebuffer = this.#boundFramebuffer(target);
      if (!framebuffer) return null;
      return this.#attachments.get(framebuffer)?.get(attachment) ?? null;
    }
    return this.#query(
      OP.getFramebufferAttachmentParameter,
      target,
      attachment,
      pname,
    );
  }

  blitFramebuffer(
    srcX0: number,
    srcY0: number,
    srcX1: number,
    srcY1: number,
    dstX0: number,
    dstY0: number,
    dstX1: number,
    dstY1: number,
    mask: number,
    filter: number,
  ): void {
    this.#draw(
      OP.blitFramebuffer,
      srcX0,
      srcY0,
      srcX1,
      srcY1,
      dstX0,
      dstY0,
      dstX1,
      dstY1,
      mask,
      filter,
    );
  }

  invalidateFramebuffer(target: number, attachments: ArrayLike<number>): void {
    this.#cmd(OP.invalidateFramebuffer, target, Array.from(attachments));
  }

  invalidateSubFramebuffer(
    target: number,
    attachments: ArrayLike<number>,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    this.#cmd(
      OP.invalidateSubFramebuffer,
      target,
      Array.from(attachments),
      x,
      y,
      width,
      height,
    );
  }

  createRenderbuffer(): LynxWebGLRenderbuffer {
    const renderbuffer = new LynxWebGLRenderbuffer(this.#nextId(), this);
    this.#cmd(OP.createRenderbuffer, renderbuffer.id);
    return renderbuffer;
  }

  deleteRenderbuffer(renderbuffer: LynxWebGLRenderbuffer | null): void {
    if (!this.#owns(renderbuffer) || renderbuffer!.deleted) return;
    renderbuffer!.deleted = true;
    if (this.#renderbuffer === renderbuffer) this.#renderbuffer = null;
    this.#cmd(OP.deleteRenderbuffer, renderbuffer!.id);
  }

  isRenderbuffer(renderbuffer: LynxWebGLRenderbuffer | null): boolean {
    return this.#isLive(renderbuffer);
  }

  bindRenderbuffer(
    target: number,
    renderbuffer: LynxWebGLRenderbuffer | null,
  ): void {
    this.#renderbuffer = renderbuffer;
    this.#cmd(OP.bindRenderbuffer, target, this.#idOf(renderbuffer));
  }

  renderbufferStorage(
    target: number,
    internalformat: number,
    width: number,
    height: number,
  ): void {
    this.#cmd(OP.renderbufferStorage, target, internalformat, width, height);
  }

  renderbufferStorageMultisample(
    target: number,
    samples: number,
    internalformat: number,
    width: number,
    height: number,
  ): void {
    this.#cmd(
      OP.renderbufferStorageMultisample,
      target,
      samples,
      internalformat,
      width,
      height,
    );
  }

  getRenderbufferParameter(target: number, pname: number): unknown {
    return this.#query(OP.getRenderbufferParameter, target, pname);
  }

  getInternalformatParameter(
    target: number,
    internalformat: number,
    pname: number,
  ): Int32Array | null {
    const value = this.#query(
      OP.getInternalformatParameter,
      target,
      internalformat,
      pname,
    );
    return value ? new Int32Array(numbersFrom(value)) : null;
  }

  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    destination: ArrayBufferView | number | null,
    dstOffset = 0,
  ): void {
    if (typeof destination === 'number') {
      this.#cmd(
        OP.readPixelsToBuffer,
        x,
        y,
        width,
        height,
        format,
        type,
        destination,
      );
      return;
    }
    if (!destination) {
      this.#fail(GL.INVALID_VALUE);
      return;
    }
    const size = pixelSize(format, type);
    const rowLength = this.#pack.rowLength || width;
    const stride = alignUp(rowLength * size, this.#pack.alignment);
    const byteLength =
      height === 0 || width === 0
        ? 0
        : (this.#pack.skipRows + height - 1) * stride +
          (this.#pack.skipPixels + width) * size;
    const target = bytesOf(destination, dstOffset);
    if (target.byteLength < byteLength) {
      this.#fail(GL.INVALID_OPERATION);
      return;
    }
    const words = this.#query(
      OP.readPixels,
      x,
      y,
      width,
      height,
      format,
      type,
      byteLength,
    ) as number[] | null;
    if (words) target.set(fromWords(words));
  }

  /**
   * --- Textures and samplers ----------------------------------------------
   */

  createTexture(): LynxWebGLTexture {
    const texture = new LynxWebGLTexture(this.#nextId(), this);
    this.#cmd(OP.createTexture, texture.id);
    return texture;
  }

  deleteTexture(texture: LynxWebGLTexture | null): void {
    if (!this.#owns(texture) || texture!.deleted) return;
    texture!.deleted = true;
    for (const unit of this.#textures) {
      for (const [target, bound] of unit ?? []) {
        if (bound === texture) unit.set(target, null);
      }
    }
    this.#cmd(OP.deleteTexture, texture!.id);
  }

  isTexture(texture: LynxWebGLTexture | null): boolean {
    return this.#isLive(texture);
  }

  bindTexture(target: number, texture: LynxWebGLTexture | null): void {
    let unit = this.#textures[this.#activeTexture];
    if (!unit) {
      unit = new Map();
      this.#textures[this.#activeTexture] = unit;
    }
    unit.set(target, texture);
    this.#cmd(OP.bindTexture, target, this.#idOf(texture));
  }

  texParameterf(target: number, pname: number, param: number): void {
    this.#cmd(OP.texParameterf, target, pname, param);
  }

  texParameteri(target: number, pname: number, param: number): void {
    this.#cmd(OP.texParameteri, target, pname, param);
  }

  getTexParameter(target: number, pname: number): unknown {
    const value = this.#query(OP.getTexParameter, target, pname);
    return pname === GL.TEXTURE_IMMUTABLE_FORMAT ? Boolean(value) : value;
  }

  texStorage2D(
    target: number,
    levels: number,
    internalformat: number,
    width: number,
    height: number,
  ): void {
    this.#cmd(OP.texStorage2D, target, levels, internalformat, width, height);
  }

  texStorage3D(
    target: number,
    levels: number,
    internalformat: number,
    width: number,
    height: number,
    depth: number,
  ): void {
    this.#cmd(
      OP.texStorage3D,
      target,
      levels,
      internalformat,
      width,
      height,
      depth,
    );
  }

  generateMipmap(target: number): void {
    this.#cmd(OP.generateMipmap, target);
  }

  /**
   * WebGL2's texImage2D overloads:
   *   (target, level, internalformat, format, type, source)
   *   (target, level, internalformat, width, height, border, format, type,
   *    pixels | pboOffset | source [, srcOffset])
   */
  texImage2D(...args: unknown[]): void {
    const [target, level, internalformat] = args as number[];
    if (args.length === 6) {
      const [, , , format, type, source] = args as [
        number,
        number,
        number,
        number,
        number,
        unknown,
      ];
      const { width, height } = this.#sourceSize(source);
      this.#cmd(
        OP.texImage2D,
        target,
        level,
        internalformat,
        width,
        height,
        0,
        format,
        type,
        this.#pixels(source, 0, width, height, 1, format, type),
      );
      return;
    }
    const [, , , width, height, border, format, type, source, srcOffset] =
      args as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        unknown,
        number | undefined,
      ];
    this.#cmd(
      OP.texImage2D,
      target,
      level,
      internalformat,
      width,
      height,
      border,
      format,
      type,
      this.#pixels(source, srcOffset ?? 0, width, height, 1, format, type),
    );
  }

  /**
   *   (target, level, xoffset, yoffset, format, type, source)
   *   (target, level, xoffset, yoffset, width, height, format, type,
   *    pixels | pboOffset | source [, srcOffset])
   */
  texSubImage2D(...args: unknown[]): void {
    const [target, level, xoffset, yoffset] = args as number[];
    if (args.length === 7) {
      const [, , , , format, type, source] = args as [
        number,
        number,
        number,
        number,
        number,
        number,
        unknown,
      ];
      const { width, height } = this.#sourceSize(source);
      this.#cmd(
        OP.texSubImage2D,
        target,
        level,
        xoffset,
        yoffset,
        width,
        height,
        format,
        type,
        this.#pixels(source, 0, width, height, 1, format, type),
      );
      return;
    }
    const [, , , , width, height, format, type, source, srcOffset] = args as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      unknown,
      number | undefined,
    ];
    this.#cmd(
      OP.texSubImage2D,
      target,
      level,
      xoffset,
      yoffset,
      width,
      height,
      format,
      type,
      this.#pixels(source, srcOffset ?? 0, width, height, 1, format, type),
    );
  }

  texImage3D(
    target: number,
    level: number,
    internalformat: number,
    width: number,
    height: number,
    depth: number,
    border: number,
    format: number,
    type: number,
    source: unknown,
    srcOffset = 0,
  ): void {
    this.#cmd(
      OP.texImage3D,
      target,
      level,
      internalformat,
      width,
      height,
      depth,
      border,
      format,
      type,
      this.#pixels(source, srcOffset, width, height, depth, format, type),
    );
  }

  texSubImage3D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    zoffset: number,
    width: number,
    height: number,
    depth: number,
    format: number,
    type: number,
    source: unknown,
    srcOffset = 0,
  ): void {
    this.#cmd(
      OP.texSubImage3D,
      target,
      level,
      xoffset,
      yoffset,
      zoffset,
      width,
      height,
      depth,
      format,
      type,
      this.#pixels(source, srcOffset, width, height, depth, format, type),
    );
  }

  /**
   * (…, border, imageSize, pboOffset) with a PIXEL_UNPACK_BUFFER bound, else
   * (…, border, srcData [, srcOffset [, srcLengthOverride]]).
   */
  compressedTexImage2D(
    target: number,
    level: number,
    internalformat: number,
    width: number,
    height: number,
    border: number,
    ...rest: unknown[]
  ): void {
    const [data, size] = this.#compressed(rest);
    this.#cmd(
      OP.compressedTexImage2D,
      target,
      level,
      internalformat,
      width,
      height,
      border,
      data,
      size,
    );
  }

  compressedTexImage3D(
    target: number,
    level: number,
    internalformat: number,
    width: number,
    height: number,
    depth: number,
    border: number,
    ...rest: unknown[]
  ): void {
    const [data, size] = this.#compressed(rest);
    this.#cmd(
      OP.compressedTexImage3D,
      target,
      level,
      internalformat,
      width,
      height,
      depth,
      border,
      data,
      size,
    );
  }

  compressedTexSubImage2D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    width: number,
    height: number,
    format: number,
    ...rest: unknown[]
  ): void {
    const [data, size] = this.#compressed(rest);
    this.#cmd(
      OP.compressedTexSubImage2D,
      target,
      level,
      xoffset,
      yoffset,
      width,
      height,
      format,
      data,
      size,
    );
  }

  compressedTexSubImage3D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    zoffset: number,
    width: number,
    height: number,
    depth: number,
    format: number,
    ...rest: unknown[]
  ): void {
    const [data, size] = this.#compressed(rest);
    this.#cmd(
      OP.compressedTexSubImage3D,
      target,
      level,
      xoffset,
      yoffset,
      zoffset,
      width,
      height,
      depth,
      format,
      data,
      size,
    );
  }

  /**
   * A compressed upload's data, and its size in bytes.
   */
  #compressed(rest: unknown[]): [unknown, number] {
    if (typeof rest[0] === 'number') {
      // From the bound PIXEL_UNPACK_BUFFER: imageSize, then the offset.
      return [rest[1] as number, rest[0]];
    }
    const [data, srcOffset = 0, srcLengthOverride = 0] = rest as [
      ArrayBufferView,
      number?,
      number?,
    ];
    const bytes = bytesOf(data, srcOffset, srcLengthOverride || undefined);
    return [toWords(bytes), bytes.byteLength];
  }

  copyTexImage2D(
    target: number,
    level: number,
    internalformat: number,
    x: number,
    y: number,
    width: number,
    height: number,
    border: number,
  ): void {
    this.#cmd(
      OP.copyTexImage2D,
      target,
      level,
      internalformat,
      x,
      y,
      width,
      height,
      border,
    );
  }

  copyTexSubImage2D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    this.#cmd(
      OP.copyTexSubImage2D,
      target,
      level,
      xoffset,
      yoffset,
      x,
      y,
      width,
      height,
    );
  }

  copyTexSubImage3D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    zoffset: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    this.#cmd(
      OP.copyTexSubImage3D,
      target,
      level,
      xoffset,
      yoffset,
      zoffset,
      x,
      y,
      width,
      height,
    );
  }

  #sourceSize(source: unknown): { width: number; height: number } {
    const image = nativeImageOf(source);
    if (image) return { width: image.width, height: image.height };
    const sized = source as { width?: number; height?: number } | null;
    if (sized && typeof sized.width === 'number') {
      return { width: sized.width, height: sized.height ?? 0 };
    }
    throw new TypeError(
      'texImage2D: the source must be an ImageBitmap, an image, ImageData or a typed array',
    );
  }

  /**
   * An upload's pixels as the `texImage*` commands carry them:
   * - `null`: no data (storage only).
   * - a number: an offset into the bound PIXEL_UNPACK_BUFFER.
   * - an array: the bytes, as words (see toWords), already flipped and
   *   premultiplied as the pixel storage asks.
   * - `{ image, flipY, premultiply }`: a decoded image, by id, which the
   *   shell converts to the format and type and flips and premultiplies as it
   *   uploads it.
   */
  #pixels(
    source: unknown,
    srcOffset: number,
    width: number,
    height: number,
    depth: number,
    format: number,
    type: number,
  ): unknown {
    if (source === null || source === undefined) return null;
    if (typeof source === 'number') return source;
    const image = nativeImageOf(source);
    if (image) {
      return {
        image: image.id,
        flipY: image.bakedOptions ? false : this.#flipY,
        premultiply: image.bakedOptions ? false : this.#premultiplyAlpha,
      };
    }
    let bytes: Uint8Array;
    if (isTypedArray(source)) {
      bytes = bytesOf(source, srcOffset);
    } else if (
      typeof source === 'object' &&
      isTypedArray((source as { data?: unknown }).data)
    ) {
      // ImageData, or three.js's `{ width, height, data }` image.
      bytes = bytesOf((source as { data: TypedArray }).data);
    } else {
      throw new TypeError(
        'texImage: a <canvas> or video can not be a texture source on Lynx; use an ImageBitmap, an image or a typed array',
      );
    }
    if (this.#flipY || this.#premultiplyAlpha) {
      bytes = this.#unpack(bytes, width, height, depth, format, type);
    }
    return toWords(bytes);
  }

  /**
   * UNPACK_FLIP_Y_WEBGL and UNPACK_PREMULTIPLY_ALPHA_WEBGL on typed-array
   * data, which GLES can't do: a copy, flipped row by row in each image of a
   * 3D upload, and premultiplied for 8-bit formats with alpha.
   */
  #unpack(
    bytes: Uint8Array,
    width: number,
    height: number,
    depth: number,
    format: number,
    type: number,
  ): Uint8Array {
    const out = new Uint8Array(bytes);
    const size = pixelSize(format, type);
    const stride = alignUp(width * size, this.#unpackAlignment);
    const imageSize = stride * height;
    if (
      this.#premultiplyAlpha &&
      type === GL.UNSIGNED_BYTE &&
      (format === GL.RGBA || format === GL.LUMINANCE_ALPHA)
    ) {
      const alphaIndex = size - 1;
      for (let row = 0; row < height * depth; row++) {
        const start = row * stride;
        for (let x = 0; x < width; x++) {
          const pixel = start + x * size;
          const alpha = out[pixel + alphaIndex] / 255;
          for (let c = 0; c < alphaIndex; c++) {
            out[pixel + c] = Math.round(out[pixel + c] * alpha);
          }
        }
      }
    }
    if (this.#flipY) {
      const flipped = new Uint8Array(out.length);
      for (let image = 0; image < depth; image++) {
        const base = image * imageSize;
        for (let row = 0; row < height; row++) {
          const from = base + row * stride;
          const to = base + (height - 1 - row) * stride;
          flipped.set(out.subarray(from, from + stride), to);
        }
      }
      // Anything past the images (an oversized buffer) stays as it was.
      flipped.set(out.subarray(imageSize * depth), imageSize * depth);
      return flipped;
    }
    return out;
  }

  createSampler(): LynxWebGLSampler {
    const sampler = new LynxWebGLSampler(this.#nextId(), this);
    this.#cmd(OP.createSampler, sampler.id);
    return sampler;
  }

  deleteSampler(sampler: LynxWebGLSampler | null): void {
    if (!this.#owns(sampler) || sampler!.deleted) return;
    sampler!.deleted = true;
    this.#samplers.forEach((bound, unit) => {
      if (bound === sampler) this.#samplers[unit] = null;
    });
    this.#cmd(OP.deleteSampler, sampler!.id);
  }

  isSampler(sampler: LynxWebGLSampler | null): boolean {
    return this.#isLive(sampler);
  }

  bindSampler(unit: number, sampler: LynxWebGLSampler | null): void {
    this.#samplers[unit] = sampler;
    this.#cmd(OP.bindSampler, unit, this.#idOf(sampler));
  }

  samplerParameteri(
    sampler: LynxWebGLSampler,
    pname: number,
    param: number,
  ): void {
    this.#cmd(OP.samplerParameteri, this.#idOf(sampler), pname, param);
  }

  samplerParameterf(
    sampler: LynxWebGLSampler,
    pname: number,
    param: number,
  ): void {
    this.#cmd(OP.samplerParameterf, this.#idOf(sampler), pname, param);
  }

  getSamplerParameter(sampler: LynxWebGLSampler, pname: number): unknown {
    return this.#query(OP.getSamplerParameter, this.#idOf(sampler), pname);
  }

  /**
   * --- Shaders and programs -----------------------------------------------
   */

  createShader(type: number): LynxWebGLShader | null {
    if (type !== GL.VERTEX_SHADER && type !== GL.FRAGMENT_SHADER) {
      this.#fail(GL.INVALID_ENUM);
      return null;
    }
    const shader = new LynxWebGLShader(this.#nextId(), this, type);
    this.#cmd(OP.createShader, shader.id, type);
    return shader;
  }

  deleteShader(shader: LynxWebGLShader | null): void {
    if (!this.#owns(shader) || shader!.deleted) return;
    shader!.deleted = true;
    this.#cmd(OP.deleteShader, shader!.id);
  }

  isShader(shader: LynxWebGLShader | null): boolean {
    return this.#isLive(shader);
  }

  shaderSource(shader: LynxWebGLShader, source: string): void {
    shader.source = source;
    this.#cmd(OP.shaderSource, this.#idOf(shader), source);
  }

  getShaderSource(shader: LynxWebGLShader): string | null {
    return this.#owns(shader) ? shader.source : null;
  }

  compileShader(shader: LynxWebGLShader): void {
    shader.info = null;
    this.#cmd(OP.compileShader, this.#idOf(shader));
  }

  #shaderInfo(shader: LynxWebGLShader): { compiled: boolean; log: string } {
    if (!shader.info) {
      const info = this.#query(OP.shaderInfo, shader.id) as {
        compiled: unknown;
        log: string;
      } | null;
      // The shells' booleans arrive as 1 and 0.
      shader.info = {
        compiled: Boolean(info?.compiled),
        log: info?.log ?? '',
      };
    }
    return shader.info;
  }

  getShaderParameter(shader: LynxWebGLShader, pname: number): unknown {
    if (!this.#owns(shader)) return null;
    switch (pname) {
      case GL.SHADER_TYPE:
        return shader.type;
      case GL.DELETE_STATUS:
        return shader.deleted;
      case GL.COMPILE_STATUS:
        return this.#shaderInfo(shader).compiled;
      default:
        this.#fail(GL.INVALID_ENUM);
        return null;
    }
  }

  getShaderInfoLog(shader: LynxWebGLShader): string | null {
    return this.#owns(shader) ? this.#shaderInfo(shader).log : null;
  }

  createProgram(): LynxWebGLProgram {
    const program = new LynxWebGLProgram(this.#nextId(), this);
    this.#cmd(OP.createProgram, program.id);
    return program;
  }

  deleteProgram(program: LynxWebGLProgram | null): void {
    if (!this.#owns(program) || program!.deleted) return;
    program!.deleted = true;
    this.#cmd(OP.deleteProgram, program!.id);
  }

  isProgram(program: LynxWebGLProgram | null): boolean {
    return this.#isLive(program);
  }

  attachShader(program: LynxWebGLProgram, shader: LynxWebGLShader): void {
    if (this.#owns(program) && this.#owns(shader)) {
      program.shaders.push(shader);
    }
    this.#cmd(OP.attachShader, this.#idOf(program), this.#idOf(shader));
  }

  detachShader(program: LynxWebGLProgram, shader: LynxWebGLShader): void {
    if (this.#owns(program)) {
      program.shaders = program.shaders.filter((s) => s !== shader);
    }
    this.#cmd(OP.detachShader, this.#idOf(program), this.#idOf(shader));
  }

  getAttachedShaders(program: LynxWebGLProgram): LynxWebGLShader[] | null {
    return this.#owns(program) ? [...program.shaders] : null;
  }

  bindAttribLocation(
    program: LynxWebGLProgram,
    index: number,
    name: string,
  ): void {
    this.#cmd(OP.bindAttribLocation, this.#idOf(program), index, name);
  }

  linkProgram(program: LynxWebGLProgram): void {
    if (this.#owns(program)) {
      program.info = null;
      program.validated = false;
      program.locations.clear();
      program.linkCount++;
    }
    this.#cmd(OP.linkProgram, this.#idOf(program));
  }

  validateProgram(program: LynxWebGLProgram): void {
    this.#cmd(OP.validateProgram, this.#idOf(program));
  }

  useProgram(program: LynxWebGLProgram | null): void {
    this.#program = program;
    this.#cmd(OP.useProgram, this.#idOf(program));
  }

  /**
   * The program's link results and reflection, in one call per link.
   */
  #programInfo(program: LynxWebGLProgram): ProgramInfo {
    if (!program.info) {
      const info = this.#query(
        OP.programInfo,
        program.id,
      ) as Partial<ProgramInfo> | null;
      program.info = {
        // The shells' booleans arrive as 1 and 0.
        linked: Boolean(info?.linked),
        log: info?.log ?? '',
        uniforms: info?.uniforms ?? [],
        attributes: info?.attributes ?? [],
        uniformBlocks: info?.uniformBlocks ?? 0,
        transformFeedbackVaryings: info?.transformFeedbackVaryings ?? 0,
      };
    }
    return program.info;
  }

  getProgramParameter(program: LynxWebGLProgram, pname: number): unknown {
    if (!this.#owns(program)) return null;
    switch (pname) {
      case GL.DELETE_STATUS:
        return program.deleted;
      case GL.ATTACHED_SHADERS:
        return program.shaders.length;
      case GL.LINK_STATUS:
        return this.#programInfo(program).linked;
      case GL.ACTIVE_UNIFORMS:
        return this.#programInfo(program).uniforms.length;
      case GL.ACTIVE_ATTRIBUTES:
        return this.#programInfo(program).attributes.length;
      case GL.ACTIVE_UNIFORM_BLOCKS:
        return this.#programInfo(program).uniformBlocks;
      case GL.TRANSFORM_FEEDBACK_VARYINGS:
        return this.#programInfo(program).transformFeedbackVaryings;
      case GL.VALIDATE_STATUS:
        return Boolean(this.#query(OP.getProgramParameter, program.id, pname));
      default:
        return this.#query(OP.getProgramParameter, program.id, pname);
    }
  }

  getProgramInfoLog(program: LynxWebGLProgram): string | null {
    return this.#owns(program) ? this.#programInfo(program).log : null;
  }

  #activeInfo(
    variables: ActiveVariable[],
    index: number,
  ): LynxWebGLActiveInfo | null {
    const variable = variables[index];
    if (!variable) {
      this.#fail(GL.INVALID_VALUE);
      return null;
    }
    return new LynxWebGLActiveInfo(variable[0], variable[1], variable[2]);
  }

  getActiveUniform(
    program: LynxWebGLProgram,
    index: number,
  ): LynxWebGLActiveInfo | null {
    if (!this.#owns(program)) return null;
    return this.#activeInfo(this.#programInfo(program).uniforms, index);
  }

  getActiveAttrib(
    program: LynxWebGLProgram,
    index: number,
  ): LynxWebGLActiveInfo | null {
    if (!this.#owns(program)) return null;
    return this.#activeInfo(this.#programInfo(program).attributes, index);
  }

  getUniformLocation(
    program: LynxWebGLProgram,
    name: string,
  ): LynxWebGLUniformLocation | null {
    if (!this.#owns(program)) return null;
    const cached = program.locations.get(name);
    if (cached !== undefined) return cached;
    const info = this.#programInfo(program);
    if (!info.linked) return null;
    // An array's location answers both `name` and `name[0]`.
    const reflected = info.uniforms.find(
      ([uniform]) =>
        uniform === name ||
        (uniform.endsWith('[0]') && uniform.slice(0, -3) === name),
    );
    const location = reflected
      ? reflected[3]
      : ((this.#query(OP.getUniformLocation, program.id, name) as number) ??
        -1);
    const result =
      location < 0
        ? null
        : new LynxWebGLUniformLocation(program, location, program.linkCount);
    program.locations.set(name, result);
    return result;
  }

  getAttribLocation(program: LynxWebGLProgram, name: string): number {
    if (!this.#owns(program)) return -1;
    const info = this.#programInfo(program);
    const reflected = info.attributes.find(([attribute]) => attribute === name);
    if (reflected) return reflected[3];
    return (
      (this.#query(OP.getAttribLocation, program.id, name) as number) ?? -1
    );
  }

  getFragDataLocation(program: LynxWebGLProgram, name: string): number {
    return (
      (this.#query(
        OP.getFragDataLocation,
        this.#idOf(program),
        name,
      ) as number) ?? -1
    );
  }

  getUniform(
    program: LynxWebGLProgram,
    location: LynxWebGLUniformLocation,
  ): unknown {
    const uniform = this.#programInfo(program).uniforms.find(
      ([, , , l]) => l === location.location,
    );
    const value = this.#query(
      OP.getUniform,
      this.#idOf(program),
      location.location,
      uniform?.[2] ?? GL.FLOAT,
    );
    return uniformValue(uniform?.[2] ?? GL.FLOAT, value);
  }

  getUniformBlockIndex(
    program: LynxWebGLProgram,
    uniformBlockName: string,
  ): number {
    return (
      (this.#query(
        OP.getUniformBlockIndex,
        this.#idOf(program),
        uniformBlockName,
      ) as number) ?? GL.INVALID_INDEX
    );
  }

  uniformBlockBinding(
    program: LynxWebGLProgram,
    uniformBlockIndex: number,
    uniformBlockBinding: number,
  ): void {
    this.#cmd(
      OP.uniformBlockBinding,
      this.#idOf(program),
      uniformBlockIndex,
      uniformBlockBinding,
    );
  }

  getActiveUniformBlockName(
    program: LynxWebGLProgram,
    uniformBlockIndex: number,
  ): string | null {
    return this.#query(
      OP.getActiveUniformBlockName,
      this.#idOf(program),
      uniformBlockIndex,
    ) as string | null;
  }

  getActiveUniformBlockParameter(
    program: LynxWebGLProgram,
    uniformBlockIndex: number,
    pname: number,
  ): unknown {
    const value = this.#query(
      OP.getActiveUniformBlockParameter,
      this.#idOf(program),
      uniformBlockIndex,
      pname,
    );
    if (pname === GL.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES) {
      return new Uint32Array(numbersFrom(value));
    }
    if (
      pname === GL.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER ||
      pname === GL.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER
    ) {
      return Boolean(value);
    }
    return value;
  }

  getActiveUniforms(
    program: LynxWebGLProgram,
    uniformIndices: ArrayLike<number>,
    pname: number,
  ): unknown {
    const value = this.#query(
      OP.getActiveUniforms,
      this.#idOf(program),
      Array.from(uniformIndices),
      pname,
    );
    if (!value) return null;
    const list = numbersFrom(value);
    return pname === GL.UNIFORM_IS_ROW_MAJOR ? list.map(Boolean) : list;
  }

  getUniformIndices(
    program: LynxWebGLProgram,
    uniformNames: string[],
  ): number[] | null {
    const value = this.#query(OP.getUniformIndices, this.#idOf(program), [
      ...uniformNames,
    ]);
    return value ? numbersFrom(value) : null;
  }

  transformFeedbackVaryings(
    program: LynxWebGLProgram,
    varyings: string[],
    bufferMode: number,
  ): void {
    this.#cmd(
      OP.transformFeedbackVaryings,
      this.#idOf(program),
      [...varyings],
      bufferMode,
    );
  }

  getTransformFeedbackVarying(
    program: LynxWebGLProgram,
    index: number,
  ): LynxWebGLActiveInfo | null {
    const value = this.#query(
      OP.getTransformFeedbackVarying,
      this.#idOf(program),
      index,
    ) as [string, number, number] | null;
    return value ? new LynxWebGLActiveInfo(value[0], value[1], value[2]) : null;
  }

  // --- Uniforms ------------------------------------------------------------

  /**
   * The GL location, or null when the call must do nothing.
   */
  #location(location: LynxWebGLUniformLocation | null): number | null {
    if (!location) return null;
    if (
      location.program !== this.#program ||
      location.linkCount !== location.program.linkCount
    ) {
      this.#fail(GL.INVALID_OPERATION);
      return null;
    }
    return location.location;
  }

  #uniform(
    op: number,
    location: LynxWebGLUniformLocation | null,
    ...values: number[]
  ): void {
    const gl = this.#location(location);
    if (gl === null) return;
    this.#cmd(op, gl, ...values);
  }

  #uniformVector(
    op: number,
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset = 0,
    srcLength = 0,
  ): void {
    const gl = this.#location(location);
    if (gl === null) return;
    this.#cmd(op, gl, numbers(data, srcOffset, srcLength));
  }

  #uniformMatrix(
    op: number,
    location: LynxWebGLUniformLocation | null,
    transpose: boolean,
    data: NumberList,
    srcOffset = 0,
    srcLength = 0,
  ): void {
    const gl = this.#location(location);
    if (gl === null) return;
    this.#cmd(op, gl, +transpose, numbers(data, srcOffset, srcLength));
  }

  uniform1f(location: LynxWebGLUniformLocation | null, x: number): void {
    this.#uniform(OP.uniform1f, location, x);
  }

  uniform2f(
    location: LynxWebGLUniformLocation | null,
    x: number,
    y: number,
  ): void {
    this.#uniform(OP.uniform2f, location, x, y);
  }

  uniform3f(
    location: LynxWebGLUniformLocation | null,
    x: number,
    y: number,
    z: number,
  ): void {
    this.#uniform(OP.uniform3f, location, x, y, z);
  }

  uniform4f(
    location: LynxWebGLUniformLocation | null,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.#uniform(OP.uniform4f, location, x, y, z, w);
  }

  uniform1i(location: LynxWebGLUniformLocation | null, x: number): void {
    this.#uniform(OP.uniform1i, location, x);
  }

  uniform2i(
    location: LynxWebGLUniformLocation | null,
    x: number,
    y: number,
  ): void {
    this.#uniform(OP.uniform2i, location, x, y);
  }

  uniform3i(
    location: LynxWebGLUniformLocation | null,
    x: number,
    y: number,
    z: number,
  ): void {
    this.#uniform(OP.uniform3i, location, x, y, z);
  }

  uniform4i(
    location: LynxWebGLUniformLocation | null,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.#uniform(OP.uniform4i, location, x, y, z, w);
  }

  uniform1ui(location: LynxWebGLUniformLocation | null, x: number): void {
    this.#uniform(OP.uniform1ui, location, x);
  }

  uniform2ui(
    location: LynxWebGLUniformLocation | null,
    x: number,
    y: number,
  ): void {
    this.#uniform(OP.uniform2ui, location, x, y);
  }

  uniform3ui(
    location: LynxWebGLUniformLocation | null,
    x: number,
    y: number,
    z: number,
  ): void {
    this.#uniform(OP.uniform3ui, location, x, y, z);
  }

  uniform4ui(
    location: LynxWebGLUniformLocation | null,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.#uniform(OP.uniform4ui, location, x, y, z, w);
  }

  uniform1fv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform1fv, location, data, srcOffset, srcLength);
  }

  uniform2fv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform2fv, location, data, srcOffset, srcLength);
  }

  uniform3fv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform3fv, location, data, srcOffset, srcLength);
  }

  uniform4fv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform4fv, location, data, srcOffset, srcLength);
  }

  uniform1iv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform1iv, location, data, srcOffset, srcLength);
  }

  uniform2iv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform2iv, location, data, srcOffset, srcLength);
  }

  uniform3iv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform3iv, location, data, srcOffset, srcLength);
  }

  uniform4iv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform4iv, location, data, srcOffset, srcLength);
  }

  uniform1uiv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform1uiv, location, data, srcOffset, srcLength);
  }

  uniform2uiv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform2uiv, location, data, srcOffset, srcLength);
  }

  uniform3uiv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform3uiv, location, data, srcOffset, srcLength);
  }

  uniform4uiv(
    location: LynxWebGLUniformLocation | null,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformVector(OP.uniform4uiv, location, data, srcOffset, srcLength);
  }

  uniformMatrix2fv(
    location: LynxWebGLUniformLocation | null,
    transpose: boolean,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformMatrix(
      OP.uniformMatrix2fv,
      location,
      transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  uniformMatrix3fv(
    location: LynxWebGLUniformLocation | null,
    transpose: boolean,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformMatrix(
      OP.uniformMatrix3fv,
      location,
      transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  uniformMatrix4fv(
    location: LynxWebGLUniformLocation | null,
    transpose: boolean,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformMatrix(
      OP.uniformMatrix4fv,
      location,
      transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  uniformMatrix2x3fv(
    location: LynxWebGLUniformLocation | null,
    transpose: boolean,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformMatrix(
      OP.uniformMatrix2x3fv,
      location,
      transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  uniformMatrix3x2fv(
    location: LynxWebGLUniformLocation | null,
    transpose: boolean,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformMatrix(
      OP.uniformMatrix3x2fv,
      location,
      transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  uniformMatrix2x4fv(
    location: LynxWebGLUniformLocation | null,
    transpose: boolean,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformMatrix(
      OP.uniformMatrix2x4fv,
      location,
      transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  uniformMatrix4x2fv(
    location: LynxWebGLUniformLocation | null,
    transpose: boolean,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformMatrix(
      OP.uniformMatrix4x2fv,
      location,
      transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  uniformMatrix3x4fv(
    location: LynxWebGLUniformLocation | null,
    transpose: boolean,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformMatrix(
      OP.uniformMatrix3x4fv,
      location,
      transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  uniformMatrix4x3fv(
    location: LynxWebGLUniformLocation | null,
    transpose: boolean,
    data: NumberList,
    srcOffset?: number,
    srcLength?: number,
  ): void {
    this.#uniformMatrix(
      OP.uniformMatrix4x3fv,
      location,
      transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  /**
   * --- Queries, syncs and transform feedback ------------------------------
   */

  createQuery(): LynxWebGLQuery {
    const query = new LynxWebGLQuery(this.#nextId(), this);
    this.#cmd(OP.createQuery, query.id);
    return query;
  }

  deleteQuery(query: LynxWebGLQuery | null): void {
    if (!this.#owns(query) || query!.deleted) return;
    query!.deleted = true;
    for (const [target, active] of this.#queries) {
      if (active === query) this.#queries.set(target, null);
    }
    this.#cmd(OP.deleteQuery, query!.id);
  }

  isQuery(query: LynxWebGLQuery | null): boolean {
    return this.#isLive(query);
  }

  beginQuery(target: number, query: LynxWebGLQuery): void {
    this.#queries.set(target, query);
    this.#cmd(OP.beginQuery, target, this.#idOf(query));
  }

  endQuery(target: number): void {
    this.#queries.set(target, null);
    this.#cmd(OP.endQuery, target);
  }

  getQuery(target: number, pname: number): LynxWebGLQuery | null {
    return pname === GL.CURRENT_QUERY
      ? (this.#queries.get(target) ?? null)
      : null;
  }

  getQueryParameter(query: LynxWebGLQuery, pname: number): unknown {
    const value = this.#query(OP.getQueryParameter, this.#idOf(query), pname);
    return pname === GL.QUERY_RESULT_AVAILABLE ? Boolean(value) : value;
  }

  fenceSync(condition: number, flags: number): LynxWebGLSync {
    const sync = new LynxWebGLSync(this.#nextId(), this);
    this.#cmd(OP.fenceSync, sync.id, condition, flags);
    return sync;
  }

  deleteSync(sync: LynxWebGLSync | null): void {
    if (!this.#owns(sync) || sync!.deleted) return;
    sync!.deleted = true;
    this.#cmd(OP.deleteSync, sync!.id);
  }

  isSync(sync: LynxWebGLSync | null): boolean {
    return this.#isLive(sync);
  }

  clientWaitSync(sync: LynxWebGLSync, flags: number, timeout: number): number {
    return (
      (this.#query(
        OP.clientWaitSync,
        this.#idOf(sync),
        flags,
        timeout,
      ) as number) ?? GL.WAIT_FAILED
    );
  }

  waitSync(sync: LynxWebGLSync, flags: number, timeout: number): void {
    this.#cmd(OP.waitSync, this.#idOf(sync), flags, timeout);
  }

  getSyncParameter(sync: LynxWebGLSync, pname: number): unknown {
    return this.#query(OP.getSyncParameter, this.#idOf(sync), pname);
  }

  createTransformFeedback(): LynxWebGLTransformFeedback {
    const transformFeedback = new LynxWebGLTransformFeedback(
      this.#nextId(),
      this,
    );
    this.#cmd(OP.createTransformFeedback, transformFeedback.id);
    return transformFeedback;
  }

  deleteTransformFeedback(
    transformFeedback: LynxWebGLTransformFeedback | null,
  ): void {
    if (!this.#owns(transformFeedback) || transformFeedback!.deleted) return;
    transformFeedback!.deleted = true;
    if (this.#transformFeedback === transformFeedback) {
      this.#transformFeedback = null;
    }
    this.#cmd(OP.deleteTransformFeedback, transformFeedback!.id);
  }

  isTransformFeedback(
    transformFeedback: LynxWebGLTransformFeedback | null,
  ): boolean {
    return this.#isLive(transformFeedback);
  }

  bindTransformFeedback(
    target: number,
    transformFeedback: LynxWebGLTransformFeedback | null,
  ): void {
    this.#transformFeedback = transformFeedback;
    this.#cmd(OP.bindTransformFeedback, target, this.#idOf(transformFeedback));
  }

  beginTransformFeedback(primitiveMode: number): void {
    this.#cmd(OP.beginTransformFeedback, primitiveMode);
  }

  endTransformFeedback(): void {
    this.#cmd(OP.endTransformFeedback);
  }

  pauseTransformFeedback(): void {
    this.#cmd(OP.pauseTransformFeedback);
  }

  resumeTransformFeedback(): void {
    this.#cmd(OP.resumeTransformFeedback);
  }

  getIndexedParameter(target: number, index: number): unknown {
    // The buffer bindings would be objects; the driver only knows GL names.
    if (
      target === GL.TRANSFORM_FEEDBACK_BUFFER_BINDING ||
      target === GL.UNIFORM_BUFFER_BINDING
    ) {
      return null;
    }
    return this.#query(OP.getIndexedParameter, target, index);
  }
}

// The constants are on the prototype and the constructor, as on
// WebGL2RenderingContext.
Object.assign(LynxWebGL2RenderingContext.prototype, GL);
Object.assign(LynxWebGL2RenderingContext, GL);

// Declaration merging gives the class the constants' types, which only an
// interface can do.
// oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for declaration merging
export interface LynxWebGL2RenderingContext extends Readonly<typeof GL> {}

/**
 * Numbers to send: a copy, since the app may change the array before the batch goes.
 */
const numbers = (
  data: NumberList,
  srcOffset: number,
  srcLength: number,
): number[] => {
  const end = srcLength ? srcOffset + srcLength : data.length;
  if (Array.isArray(data)) return data.slice(srcOffset, end);
  const typed = data as unknown as TypedArray;
  return Array.from(
    srcOffset || end !== typed.length ? typed.subarray(srcOffset, end) : typed,
  );
};

// The uniform types getUniform answers with a number, and with each kind of
// vector; the rest (float vectors and matrices) are Float32Arrays.
const SCALAR_UNIFORMS = new Set<number>([
  GL.FLOAT,
  GL.INT,
  GL.UNSIGNED_INT,
  GL.SAMPLER_2D,
  GL.SAMPLER_3D,
  GL.SAMPLER_CUBE,
  GL.SAMPLER_2D_SHADOW,
  GL.SAMPLER_2D_ARRAY,
  GL.SAMPLER_2D_ARRAY_SHADOW,
  GL.SAMPLER_CUBE_SHADOW,
  GL.INT_SAMPLER_2D,
  GL.INT_SAMPLER_3D,
  GL.INT_SAMPLER_CUBE,
  GL.INT_SAMPLER_2D_ARRAY,
  GL.UNSIGNED_INT_SAMPLER_2D,
  GL.UNSIGNED_INT_SAMPLER_3D,
  GL.UNSIGNED_INT_SAMPLER_CUBE,
  GL.UNSIGNED_INT_SAMPLER_2D_ARRAY,
]);
const BOOL_VECTORS = new Set<number>([
  GL.BOOL_VEC2,
  GL.BOOL_VEC3,
  GL.BOOL_VEC4,
]);
const INT_VECTORS = new Set<number>([GL.INT_VEC2, GL.INT_VEC3, GL.INT_VEC4]);
const UINT_VECTORS = new Set<number>([
  GL.UNSIGNED_INT_VEC2,
  GL.UNSIGNED_INT_VEC3,
  GL.UNSIGNED_INT_VEC4,
]);

/**
 * A uniform's value, typed as getUniform returns it.
 */
const uniformValue = (type: number, value: unknown): unknown => {
  if (value === null) return null;
  const list =
    typeof (value as unknown[]).map === 'function'
      ? numbersFrom(value)
      : [value as number];
  if (SCALAR_UNIFORMS.has(type)) return list[0];
  if (type === GL.BOOL) return Boolean(list[0]);
  if (BOOL_VECTORS.has(type)) return list.map(Boolean);
  if (INT_VECTORS.has(type)) return new Int32Array(list);
  if (UINT_VECTORS.has(type)) return new Uint32Array(list);
  return new Float32Array(list);
};
