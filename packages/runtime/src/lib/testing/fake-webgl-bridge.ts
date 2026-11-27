// The shells' AngularLynxWebGL module, faked for the runtime's <canvas>
// specs: it records every batch the context sends, answers the batch a new
// context sends first (its limits, precisions and extensions), and answers
// later queries from a queue the spec fills.
//
// Not exported from public-api.ts: this is test-only infrastructure, never
// shipped in the published package.
import { vi } from 'vitest';
import type {
  DecodedImage,
  ImageCopyOptions,
  WebGLBridge,
} from '../canvas/webgl-bridge';
import { OP } from '../canvas/webgl-ops';

export type FakeWebGLBridge = {
  /** Every batch `run` was sent, in order. */
  batches: unknown[][];
  /** Answers for the next batch that asks something, in order. */
  answers: unknown[];
  /** The GL extensions the fake driver lists. */
  glExtensions: string[];
  /** What `getParameter` answers for a limit, by pname. */
  limits: Map<number, unknown>;
  create: ReturnType<typeof vi.fn<WebGLBridge['create']>>;
  destroy: ReturnType<typeof vi.fn<WebGLBridge['destroy']>>;
  decodeImage: ReturnType<typeof vi.fn<WebGLBridge['decodeImage']>>;
  releaseImage: ReturnType<typeof vi.fn<WebGLBridge['releaseImage']>>;
  /** Answers with the size asked for: the resize, or the canvas's. */
  imageFromCanvas: ReturnType<typeof vi.fn<WebGLBridge['imageFromCanvas']>>;
  /** Answers with the size asked for: the resize, the crop's, or 4 by 2. */
  imageFromImage: ReturnType<typeof vi.fn<WebGLBridge['imageFromImage']>>;
  /** Answers with the size asked for: the resize, the crop's, or the pixels'. */
  imageFromPixels: ReturnType<typeof vi.fn<WebGLBridge['imageFromPixels']>>;
  /** Answers with a file of bytes 1 and 2, of the type asked for. */
  encodeImage: ReturnType<typeof vi.fn<WebGLBridge['encodeImage']>>;
  /** Every command sent after the first batch, flattened. */
  sent(): unknown[];
} & WebGLBridge;

export const createFakeWebGLBridge = (): FakeWebGLBridge => {
  const fake: FakeWebGLBridge = {
    batches: [],
    answers: [],
    glExtensions: [
      'GL_EXT_color_buffer_float',
      'GL_EXT_texture_filter_anisotropic',
      'GL_KHR_texture_compression_astc_ldr',
    ],
    limits: new Map(),
    create: vi.fn(() => ({ ok: true })),
    destroy: vi.fn(),
    decodeImage: vi.fn((_imageId, _bytes, options) => copied(options, 4, 2)),
    releaseImage: vi.fn(),
    imageFromCanvas: vi.fn((_imageId, _canvasId, options) =>
      copied(options, options.width, options.height),
    ),
    imageFromImage: vi.fn((_imageId, _sourceId, options) =>
      copied(options, 4, 2),
    ),
    imageFromPixels: vi.fn((_imageId, _bytes, options) =>
      copied(options, options.width, options.height),
    ),
    encodeImage: vi.fn((_contextId, { type }) => ({ base64: 'AQI=', type })),
    run: (_contextId, commands) => {
      fake.batches.push(commands);
      if (commands[0] === OP.resize && commands.includes(OP.getError)) {
        return answerFirstBatch(fake, commands);
      }
      return fake.answers.splice(0);
    },
    sent: () => fake.batches.slice(1).flat(),
  };
  return fake;
};

/**
 * What the shell answers for a copy of a source of `width` by `height`: the
 * resize's size, or the crop's, or the source's, and whether it cropped.
 */
const copied = (
  options: ImageCopyOptions,
  width: number,
  height: number,
): DecodedImage => {
  const crop = !!options.cropWidth;
  return {
    width: options.resizeWidth || (crop ? options.cropWidth : width),
    height: options.resizeHeight || (crop ? options.cropHeight : height),
    ...(crop ? { cropped: true } : {}),
  };
};

/**
 * The first batch: `resize`, then `getParameter` for each limit,
 * `getShaderPrecisionFormat` for each precision, the extensions and an error
 * check.
 */
const answerFirstBatch = (
  fake: FakeWebGLBridge,
  commands: unknown[],
): unknown[] => {
  const results: unknown[] = [];
  let i = 3;
  while (commands[i] === OP.getParameter) {
    const pname = commands[i + 1] as number;
    results.push(fake.limits.has(pname) ? fake.limits.get(pname) : 4096);
    i += 2;
  }
  while (commands[i] === OP.getShaderPrecisionFormat) {
    results.push([127, 127, 23]);
    i += 3;
  }
  results.push(fake.glExtensions, 0);
  return results;
};
