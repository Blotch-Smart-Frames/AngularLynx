import { writePendingClasses } from '../lynx-element/class-writes';
import { type LayoutRect, toDOMRect } from '../lynx-element/layout';
import { CANVAS_SOURCE } from './canvas-source';
import { acceptPageInstances } from './web-instanceof';
import {
  WEBGL2_CONTEXT,
  WEBGL_OBJECT,
  WEBGL_OBJECT_NAMES,
  type WebGLObjectName,
} from './webgl2-brand';

/**
 * A template's element: a LynxElement, told apart by shape rather than class,
 * so these polyfills, which run before everything else, don't load the
 * element module.
 */
type LayoutElement = {
  readonly element: unknown;
  readonly layoutRect: LayoutRect | null;
  observeLayout(observer: (rect: LayoutRect) => void): () => void;
};

const isLynxElement = (value: unknown): value is LayoutElement =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as LayoutElement).observeLayout === 'function' &&
  'element' in value;

/**
 * The main thread's `performance`, which native Lynx doesn't have.
 *
 * Its clock is `__date_clock()`, a global of PrimJS, the engine that runs
 * the main thread on every platform (`js_global_funcs` in its
 * `quickjs.cc`): the time since the epoch, in microseconds, from the
 * system's wall clock. Dividing by 1,000 gives milliseconds with three decimal
 * places, as a browser's `performance.now()` has, where `Date.now()` steps in
 * whole milliseconds, longer than most of the work an app would time.
 * `Date.now()` is the fallback for an engine without it. Neither clock is
 * monotonic, as a browser's is: a change to the device's time moves both.
 */
const createPerformance = (
  target: Record<string, any>,
): { timeOrigin: number; now: () => number } => {
  const dateClock: unknown = target['__date_clock'];
  if (typeof dateClock !== 'function') {
    const timeOrigin = Date.now();
    return { timeOrigin, now: () => Date.now() - timeOrigin };
  }
  const micros = (): number => Number((dateClock as () => number)());
  const originMicros = micros();
  // Subtracted in microseconds, then divided: the epoch's microseconds are
  // whole numbers a double holds exactly, while its milliseconds, about
  // 1.8e12 with three decimal places, would round each reading to a quarter
  // of a microsecond.
  return {
    timeOrigin: originMicros / 1000,
    now: () => (micros() - originMicros) / 1000,
  };
};

/**
 * The browser globals three.js and angular-three reach for, on Lynx's main
 * thread, which has no DOM. Each is installed only where it's missing, so the
 * web preview's main thread, a browser frame, keeps its own; there, the ones
 * that take an element (`ResizeObserver`, `getComputedStyle`) are wrapped to
 * take a Lynx element too, since a template's elements are LynxElements, not
 * DOM nodes.
 *
 * - `performance.now()`: three.js's Clock times frames with it, and apps
 *   profile with it. It reads the engine's clock, in fractions of a
 *   millisecond, as a browser's does (see `createPerformance()`).
 * - `crypto.randomUUID()`: angular-three names every object it makes with
 *   one. Lynx's main thread has no secure random source, so this one comes
 *   from `Math.random()`: unique, but not for secrets. `getRandomValues()`
 *   is left out, so code that needs real randomness finds none rather than a
 *   weak one.
 * - `self`: three.js's glTF loader reads `self.URL`.
 * - `ProgressEvent`: three.js's FileLoader fires one per chunk it reads.
 * - `HTMLElement`: a template's elements are instances of it, as a page's are
 *   of the browser's, for the `instanceof` checks angular-three and
 *   ngxtension make before using an element as one. angular-three takes its
 *   pointer listeners off the element its events connect to only if it's an
 *   `HTMLElement`, so with no instances they stayed on every canvas's host,
 *   holding its scene, after the canvas had gone.
 * - `HTMLCanvasElement`: a template's `<canvas>` and a canvas made with
 *   `document.createElement('canvas')` are instances of it.
 * - `HTMLVideoElement`: a template's `<video>` is an instance of it, as
 *   three.js checks before sizing a VideoTexture by its `videoWidth` and
 *   `videoHeight` (see video-element.ts).
 * - The classes that make a canvas or an image (`document.createElement('canvas')`,
 *   `OffscreenCanvas`, `ImageData`, `Image`, `ImageBitmap`,
 *   `createImageBitmap()` and the rest) come with the canvas, in the apps
 *   with a module that can make one (enable-canvas.ts), and the 2D context's
 *   own classes (`CanvasRenderingContext2D`, `Path2D` and the rest) with the
 *   context (enable-canvas-2d.ts). Here they'd be in every app. The classes
 *   below only tell an object apart, by a mark it carries rather than by its
 *   class, so they don't bring the canvas with them.
 * - `WebGL2RenderingContext`: a canvas's `getContext('webgl2')` is an
 *   instance of it, as WebGL libraries check before making WebGL2-only calls,
 *   and `typeof WebGL2RenderingContext` is how they ask whether there's
 *   WebGL2 at all. `WebGLRenderingContext` is there too, so an `instanceof`
 *   against it answers rather than throwing, though nothing is an instance of
 *   it: Lynx has no WebGL1 context, and in a browser a WebGL2 context isn't
 *   one either.
 * - `WebGLBuffer`, `WebGLTexture`, `WebGLProgram` and WebGL2's other object
 *   classes (see webgl2-brand.ts): what the context's `createBuffer()`,
 *   `createTexture()`, `getUniformLocation()`, `getActiveUniform()` and the
 *   rest return is an instance of the one a browser's would be, as WebGL
 *   helper libraries check to tell an object from the options to make one.
 * - `devicePixelRatio`: from Lynx's SystemInfo, so a 3D scene renders at the
 *   screen's resolution.
 * - `getComputedStyle()`: ngxtension's resize directive reads an element's
 *   overflow with it. Lynx has no computed styles on the main thread, so it
 *   answers with empty values.
 * - `ResizeObserver`: from each element's `layoutchange` (see layout.ts), as
 *   angular-three sizes its canvas by observing its host.
 * - In the web preview, a template's elements and the contexts its canvases
 *   make are `instanceof` the classes above, as on Lynx, though they're of
 *   the page and Angular runs in an iframe (see web-instanceof.ts).
 */
export const installCanvasGlobals = (target: Record<string, any>): void => {
  const install = (name: string, value: unknown): void => {
    if (typeof target[name] === 'undefined') target[name] = value;
  };

  if (typeof target['performance'] === 'undefined') {
    target['performance'] = createPerformance(target);
  }
  install('crypto', { randomUUID });
  install('self', target);
  install('ProgressEvent', LynxProgressEvent);
  install('HTMLElement', LynxHTMLElement);
  install('HTMLCanvasElement', LynxHTMLCanvasElement);
  install('HTMLVideoElement', LynxHTMLVideoElement);
  install('WebGL2RenderingContext', LynxWebGL2RenderingContextGlobal);
  install('WebGLRenderingContext', LynxWebGLRenderingContextGlobal);
  for (const name of WEBGL_OBJECT_NAMES) {
    if (typeof target[name] === 'undefined') {
      target[name] = webGLObjectGlobal(name);
    }
  }
  // The web preview's own classes, which the ones above leave in place. On
  // Lynx, they're the runtime's, which read a template's element already.
  if (__WEB__) acceptPageInstances(target);
  if (typeof target['devicePixelRatio'] === 'undefined') {
    target['devicePixelRatio'] = pixelRatio();
  }

  const nativeResizeObserver = target['ResizeObserver'];
  if (typeof nativeResizeObserver === 'undefined') {
    target['ResizeObserver'] = LynxResizeObserver;
  } else if (!nativeResizeObserver.forLynxElements) {
    target['ResizeObserver'] = wrapResizeObserver(nativeResizeObserver);
  }

  const nativeGetComputedStyle = target['getComputedStyle'];
  if (typeof nativeGetComputedStyle !== 'function') {
    target['getComputedStyle'] = Object.assign(
      () => emptyComputedStyle(),
      // Already takes a Lynx element, so it's never wrapped.
      { forLynxElements: true },
    );
  } else if (!nativeGetComputedStyle.forLynxElements) {
    const wrapped = (element: unknown, pseudo?: string | null) => {
      if (!isLynxElement(element)) {
        return nativeGetComputedStyle.call(target, element, pseudo);
      }
      // The DOM element's styles follow its classes, which change detection
      // may be holding back (see class-writes.ts): in the testing library's
      // DOM, which runs the native code paths.
      writePendingClasses();
      const node = element.element as unknown as Element;
      const view = node.ownerDocument?.defaultView;
      return view ? view.getComputedStyle(node, pseudo) : emptyComputedStyle();
    };
    target['getComputedStyle'] = Object.assign(wrapped, {
      forLynxElements: true,
    });
  }
};

const randomUUID = (): string => {
  const hex = (count: number) =>
    Array.from({ length: count }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  // Version 4, variant 10xx.
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
};

const pixelRatio = (): number => {
  const lynxGlobal = (
    globalThis as { lynx?: { SystemInfo?: { pixelRatio?: number } } }
  ).lynx;
  const systemInfo =
    lynxGlobal?.SystemInfo ??
    (globalThis as { SystemInfo?: { pixelRatio?: number } }).SystemInfo;
  return systemInfo?.pixelRatio ?? 1;
};

class LynxProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  defaultPrevented = false;
  constructor(
    readonly type: string,
    init: { lengthComputable?: boolean; loaded?: number; total?: number } = {},
  ) {
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {}
}

/**
 * The tag of something a canvas context can read as an image (see
 * canvas-source.ts), in lower case: `canvas` for a template's `<canvas>`
 * and one made with `document.createElement('canvas')` (whose `tagName` is
 * `CANVAS`, as an element's is in an HTML document), `video` for a
 * template's `<video>`. Undefined for an OffscreenCanvas, which has no tag,
 * and for anything else. The tag tells them apart rather than their classes,
 * which are in the build only with the canvas (enable-canvas.ts).
 */
const sourceTag = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || !(CANVAS_SOURCE in value))
    return undefined;
  const tagName = (value as { tagName?: unknown }).tagName;
  return typeof tagName === 'string' ? tagName.toLowerCase() : undefined;
};

/**
 * A template's element is one (see installCanvasGlobals), and so is a canvas
 * made with `document.createElement()`.
 */
class LynxHTMLElement {
  static [Symbol.hasInstance](value: unknown): boolean {
    return isLynxElement(value) || sourceTag(value) === 'canvas';
  }
}

class LynxHTMLCanvasElement {
  static [Symbol.hasInstance](value: unknown): boolean {
    return sourceTag(value) === 'canvas';
  }
}

class LynxHTMLVideoElement {
  // HTMLMediaElement's readyState constants, which code compares with as
  // `HTMLVideoElement.HAVE_CURRENT_DATA` as well as on an instance.
  static readonly HAVE_NOTHING = 0;
  static readonly HAVE_METADATA = 1;
  static readonly HAVE_CURRENT_DATA = 2;
  static readonly HAVE_FUTURE_DATA = 3;
  static readonly HAVE_ENOUGH_DATA = 4;

  static [Symbol.hasInstance](value: unknown): boolean {
    return sourceTag(value) === 'video';
  }
}

/**
 * The `WebGL2RenderingContext` global on iOS and Android (see
 * installCanvasGlobals). It recognizes the runtime's context by the mark it
 * carries, since the context's class is in the build only when something
 * names `'webgl2'` (see webgl2-brand.ts). `ɵenableWebGL2()` gives it the
 * context's constants, as `WebGL2RenderingContext.FLOAT` is in a browser,
 * once there's a context to use them with: here they'd be in every app.
 */
export class LynxWebGL2RenderingContextGlobal {
  /**
   * Throws, as a browser's does: contexts come from getContext().
   */
  constructor() {
    throw new TypeError('Illegal constructor');
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<symbol, unknown>)[WEBGL2_CONTEXT] === true
    );
  }
}

/**
 * The `WebGLRenderingContext` global on iOS and Android, which nothing is an
 * instance of (see installCanvasGlobals).
 */
class LynxWebGLRenderingContextGlobal {
  constructor() {
    throw new TypeError('Illegal constructor');
  }

  static [Symbol.hasInstance](): boolean {
    return false;
  }
}

/**
 * The global for one of WebGL's object interfaces on iOS and Android, such
 * as `WebGLTexture` (see installCanvasGlobals). Like the
 * `WebGL2RenderingContext` global, it knows the runtime's objects by the mark
 * they carry, as their classes are in the build only with the context (see
 * webgl2-brand.ts). Named as a browser's is, so `WebGLTexture.name` reads as
 * there.
 */
const webGLObjectGlobal = (name: WebGLObjectName) => {
  const Global = class {
    /**
     * Throws, as a browser's does: the objects come from the context.
     */
    constructor() {
      throw new TypeError('Illegal constructor');
    }

    static [Symbol.hasInstance](value: unknown): boolean {
      return (
        typeof value === 'object' &&
        value !== null &&
        (value as Record<symbol, unknown>)[WEBGL_OBJECT] === name
      );
    }
  };
  Object.defineProperty(Global, 'name', { value: name });
  return Global;
};

const emptyComputedStyle = (): Record<string, unknown> =>
  new Proxy(
    { getPropertyValue: () => '' },
    {
      get: (target, name) =>
        name in target ? target[name as 'getPropertyValue'] : '',
    },
  );

type ResizeCallback = (entries: unknown[], observer: unknown) => void;

const sizeOf = (width: number, height: number) => [
  { inlineSize: width, blockSize: height },
];

/**
 * A ResizeObserverEntry for a Lynx element's box.
 */
const entryFor = (target: LayoutElement, rect: LayoutRect) => {
  const ratio = pixelRatio();
  return {
    target,
    contentRect: toDOMRect({
      left: 0,
      top: 0,
      width: rect.width,
      height: rect.height,
    }),
    borderBoxSize: sizeOf(rect.width, rect.height),
    contentBoxSize: sizeOf(rect.width, rect.height),
    devicePixelContentBoxSize: sizeOf(
      Math.round(rect.width * ratio),
      Math.round(rect.height * ratio),
    ),
  };
};

/**
 * `ResizeObserver` for Lynx elements, from their `layoutchange` events. As a
 * browser's does, it reports an element's size when observing starts (once
 * the element has been laid out), then after each layout that resizes it.
 */
class LynxResizeObserver {
  static readonly forLynxElements = true;
  readonly #callback: ResizeCallback;
  readonly #observed = new Map<LayoutElement, () => void>();

  constructor(callback: ResizeCallback) {
    this.#callback = callback;
  }

  observe(target: unknown): void {
    if (!isLynxElement(target)) {
      throw new TypeError(
        "Failed to execute 'observe' on 'ResizeObserver': the target is not an element",
      );
    }
    if (this.#observed.has(target)) return;
    let last: LayoutRect | null = null;
    const notify = (rect: LayoutRect) => {
      if (last && last.width === rect.width && last.height === rect.height) {
        return;
      }
      last = rect;
      this.#callback([entryFor(target, rect)], this);
    };
    this.#observed.set(target, target.observeLayout(notify));
    const rect = target.layoutRect;
    if (rect) {
      queueMicrotask(() => {
        if (this.#observed.has(target)) notify(rect);
      });
    }
  }

  unobserve(target: unknown): void {
    if (!isLynxElement(target)) return;
    this.#observed.get(target)?.();
    this.#observed.delete(target);
  }

  disconnect(): void {
    for (const stop of this.#observed.values()) stop();
    this.#observed.clear();
  }
}

/**
 * The browser's `ResizeObserver` (the web preview's), taking a Lynx element
 * for the DOM element it wraps, and reporting it as the entry's target.
 */
const wrapResizeObserver = (NativeResizeObserver: any) => {
  return class LynxWebResizeObserver {
    static readonly forLynxElements = true;
    readonly #observer: any;
    readonly #targets = new Map<unknown, unknown>();

    constructor(callback: ResizeCallback) {
      this.#observer = new NativeResizeObserver((entries: any[]) => {
        callback(
          entries.map((entry) => {
            const wrapper = this.#targets.get(entry.target);
            if (!wrapper) return entry;
            return {
              target: wrapper,
              contentRect: entry.contentRect,
              borderBoxSize: entry.borderBoxSize,
              contentBoxSize: entry.contentBoxSize,
              devicePixelContentBoxSize: entry.devicePixelContentBoxSize,
            };
          }),
          this,
        );
      });
    }

    observe(target: unknown, options?: unknown): void {
      const node = isLynxElement(target) ? target.element : target;
      if (isLynxElement(target)) this.#targets.set(node, target);
      this.#observer.observe(node, options);
    }

    unobserve(target: unknown): void {
      const node = isLynxElement(target) ? target.element : target;
      this.#targets.delete(node);
      this.#observer.unobserve(node);
    }

    disconnect(): void {
      this.#targets.clear();
      this.#observer.disconnect();
    }
  };
};
