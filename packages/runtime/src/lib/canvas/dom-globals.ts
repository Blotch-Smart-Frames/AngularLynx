import { type LayoutRect, toDOMRect } from '../lynx-element/layout';
import { createImageBitmap, LynxImageBitmap, LynxImageElement } from './image';

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
 * The browser globals three.js and angular-three reach for, on Lynx's main
 * thread, which has no DOM. Each is installed only where it's missing, so the
 * web preview's main thread, a browser frame, keeps its own; there, the ones
 * that take an element (`ResizeObserver`, `getComputedStyle`) are wrapped to
 * take a Lynx element too, since a template's elements are LynxElements, not
 * DOM nodes.
 *
 * - `performance.now()`: three.js's Clock times frames with it.
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
 * - `HTMLCanvasElement`: a class nothing is an instance of, for the checks
 *   that only need the class to exist.
 * - `Image`, `HTMLImageElement`, `ImageBitmap`, `createImageBitmap()`, and
 *   `document.createElement('img')`: see image.ts.
 * - `devicePixelRatio`: from Lynx's SystemInfo, so a 3D scene renders at the
 *   screen's resolution.
 * - `getComputedStyle()`: ngxtension's resize directive reads an element's
 *   overflow with it. Lynx has no computed styles on the main thread, so it
 *   answers with empty values.
 * - `ResizeObserver`: from each element's `layoutchange` (see layout.ts), as
 *   angular-three sizes its canvas by observing its host.
 */
export const installCanvasGlobals = (target: Record<string, any>): void => {
  const install = (name: string, value: unknown): void => {
    if (typeof target[name] === 'undefined') target[name] = value;
  };

  if (typeof target['performance'] === 'undefined') {
    const timeOrigin = Date.now();
    target['performance'] = { timeOrigin, now: () => Date.now() - timeOrigin };
  }
  install('crypto', { randomUUID });
  install('self', target);
  install('ProgressEvent', LynxProgressEvent);
  install('HTMLElement', LynxHTMLElement);
  install('HTMLCanvasElement', LynxHTMLCanvasElement);
  install('Image', LynxImageElement);
  install('HTMLImageElement', LynxImageElement);
  install('ImageBitmap', LynxImageBitmap);
  install('createImageBitmap', createImageBitmap);
  if (typeof target['devicePixelRatio'] === 'undefined') {
    target['devicePixelRatio'] = pixelRatio();
  }

  const document = target['document'] as
    | {
        createElement?: unknown;
        createElementNS?: unknown;
      }
    | undefined;
  if (document && typeof document.createElement !== 'function') {
    document.createElement = createDetachedElement;
    document.createElementNS = (_namespace: string, name: string) =>
      createDetachedElement(name);
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
 * A template's element is one (see installCanvasGlobals).
 */
class LynxHTMLElement {
  static [Symbol.hasInstance](value: unknown): boolean {
    return isLynxElement(value);
  }
}

class LynxHTMLCanvasElement {
  static [Symbol.hasInstance](): boolean {
    return false;
  }
}

/**
 * `document.createElement()` on Lynx's main thread: images only.
 */
const createDetachedElement = (name: string): LynxImageElement => {
  if (name.toLowerCase() === 'img') return new LynxImageElement();
  throw new Error(
    `document.createElement('${name}') is not available on Lynx: elements come from templates. Put a <canvas> in a template to draw with WebGL.`,
  );
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
