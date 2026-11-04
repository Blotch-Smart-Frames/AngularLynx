/**
 * The native side of `<canvas>`'s WebGL2 context: the `AngularLynxWebGL`
 * module that the iOS and Android shells register (`AngularLynxWebGL.m`,
 * `WebGLModule.kt`), which runs the calls on OpenGL ES 3.0.
 *
 * Angular runs on Lynx's main thread, and WebGL is synchronous: a program's
 * link status, a uniform's location and the like are return values. Lynx's
 * background-thread `NativeModules` can't answer those, and the relay to them
 * (background-call.ts) is asynchronous. So the shells turn on Lynx's
 * main-thread modules (`enableMTSModule`), which main-thread code calls as
 * `lynx.module(name).invoke(method, ...args)`, synchronously, on the UI
 * thread, where GL runs.
 *
 * A call costs a few microseconds on Android and about 80 on iOS, where Lynx
 * logs every module call. So the context doesn't make one per GL call: it
 * records the calls into an array of commands and sends them in one `run`,
 * once a frame or when a call needs an answer (see LynxWebGL2RenderingContext).
 *
 * What crosses the bridge, as measured on Lynx 4.1: numbers, strings, arrays
 * and plain objects. An `ArrayBuffer` or typed array arrives as an empty map,
 * a returned `NSData` crashes the main thread's PrimJS, and a string ends at
 * its first NUL. So bytes (buffer data, pixels, image files) cross as arrays
 * of 32-bit words, which `Array.from(new Uint32Array(buffer))` builds at C
 * speed and the native side reads back into memory (see toWords()).
 */

/** The module's name in both shells. */
export const WEBGL_MODULE_NAME = 'AngularLynxWebGL';

export { fromWords, numbersFrom, toWords } from '../network/words';

/** What `create` returns: the drawing buffer the shell made, or why not. */
export type WebGLCreateResult = {
  /** The GL context was made: OpenGL ES 3.0 is available. */
  ok: boolean;
  /** Why it wasn't, when `ok` is false. */
  error?: string;
};

/** What `decodeImage` returns. */
export type DecodedImage = {
  width: number;
  height: number;
  /** Set instead of the size when the bytes aren't an image the OS decodes. */
  error?: string;
};

/**
 * The module's methods. `run` returns one result per query command in the
 * batch, in order; void commands return nothing.
 */
export type WebGLBridge = {
  create(
    contextId: number,
    canvasId: string,
    attributes: Record<string, unknown>,
  ): WebGLCreateResult;
  run(contextId: number, commands: unknown[]): unknown[];
  destroy(contextId: number): void;
  decodeImage(
    imageId: number,
    bytes: number[],
    options: Record<string, unknown>,
  ): DecodedImage;
  releaseImage(imageId: number): void;
};

type LynxModuleHandle = {
  invoke(method: string, ...args: unknown[]): unknown;
};

let override: WebGLBridge | null | undefined;
/** The bridge, once looked up: the host's modules don't change. */
let cached: WebGLBridge | null | undefined;

/**
 * Replaces the native bridge, for tests: a fake GL that records commands.
 * `undefined` restores the real one.
 */
export const setWebGLBridgeForTesting = (
  bridge: WebGLBridge | null | undefined,
): void => {
  override = bridge;
};

/**
 * The bridge, or null where there's no WebGL: a host without the module (Lynx
 * Explorer, an app built before this shell), the web preview (which draws in
 * the browser's own canvas), and tests.
 */
export const getWebGLBridge = (): WebGLBridge | null => {
  if (override !== undefined) return override;
  if (cached === undefined) cached = lookUpBridge();
  return cached;
};

const lookUpBridge = (): WebGLBridge | null => {
  const lynxGlobal = (globalThis as { lynx?: { module?: unknown } }).lynx;
  if (typeof lynxGlobal?.module !== 'function') return null;
  let module: LynxModuleHandle | undefined;
  try {
    module = (lynxGlobal.module as (name: string) => LynxModuleHandle)(
      WEBGL_MODULE_NAME,
    );
  } catch {
    return null;
  }
  // Lynx returns undefined, or an object whose calls answer nothing, for a
  // module the host didn't register. `create` always answers when it's there.
  if (!module || typeof module.invoke !== 'function') return null;
  const handle = module;
  return {
    create: (contextId, canvasId, attributes) =>
      (handle.invoke('create', contextId, canvasId, attributes) as
        | WebGLCreateResult
        | undefined) ?? {
        ok: false,
        error: `${WEBGL_MODULE_NAME} isn't registered in this app's shell`,
      },
    run: (contextId, commands) =>
      (handle.invoke('run', contextId, commands) as unknown[] | undefined) ??
      [],
    destroy: (contextId) => void handle.invoke('destroy', contextId),
    decodeImage: (imageId, bytes, options) =>
      (handle.invoke('decodeImage', imageId, bytes, options) as
        | DecodedImage
        | undefined) ?? {
        width: 0,
        height: 0,
        error: `${WEBGL_MODULE_NAME} isn't registered in this app's shell`,
      },
    releaseImage: (imageId) => void handle.invoke('releaseImage', imageId),
  };
};

/** The bytes a typed array or buffer views, as a Uint8Array over them. */
export const bytesOf = (
  data: ArrayBufferView | ArrayBuffer,
  elementOffset = 0,
  elementLength?: number,
): Uint8Array => {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(
      data,
      elementOffset,
      elementLength ?? data.byteLength - elementOffset,
    );
  }
  const elementSize =
    (data as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
  const count = elementLength ?? data.byteLength / elementSize - elementOffset;
  return new Uint8Array(
    data.buffer,
    data.byteOffset + elementOffset * elementSize,
    count * elementSize,
  );
};
