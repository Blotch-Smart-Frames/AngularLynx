/**
 * The web preview's canvas APIs taking a template's `<video>` or `<canvas>`
 * as an image, as they do on iOS and Android.
 *
 * In Lynx for Web, `viewChild()`'s `nativeElement` is AngularLynx's element
 * (LynxVideoElement, LynxCanvasElement), which wraps the page's DOM element,
 * and a canvas context is the browser's own: of the page for a template's
 * `<canvas>`, of web-core's main-thread iframe for one made with
 * `document.createElement('canvas')` or `new OffscreenCanvas()`. The browser
 * takes only its own image sources, so `drawImage(video)` threw a TypeError.
 * These methods are wrapped to pass the DOM element in the wrapper's place.
 */

/**
 * The methods that take an image, by the classes that have them. Every
 * argument is checked rather than the image's position, which changes with
 * the overload: texImage2D's source is its 6th argument or its 9th.
 */
const IMAGE_METHODS: Readonly<Record<string, readonly string[]>> = {
  CanvasRenderingContext2D: ['drawImage', 'createPattern'],
  OffscreenCanvasRenderingContext2D: ['drawImage', 'createPattern'],
  WebGLRenderingContext: ['texImage2D', 'texSubImage2D'],
  WebGL2RenderingContext: [
    'texImage2D',
    'texSubImage2D',
    'texImage3D',
    'texSubImage3D',
  ],
};

/** Every method name above, for a context whose class isn't looked up. */
const ALL_IMAGE_METHODS: readonly string[] = [
  ...new Set(Object.values(IMAGE_METHODS).flat()),
];

/** The wrappers made here, so nothing is wrapped twice. */
const wrappers = new WeakSet<object>();

/**
 * A template's element: an object holding its DOM element as `element`, and
 * observing its layout as every LynxElement does. Told apart by shape, so
 * these globals, installed before everything else, don't load the element
 * module.
 */
const isTemplateElement = (value: unknown): value is { element: unknown } =>
  typeof value === 'object' &&
  value !== null &&
  'element' in value &&
  typeof (value as { observeLayout?: unknown }).observeLayout === 'function';

/**
 * The image the browser reads: a template element's DOM element, or the
 * value itself.
 */
export const unwrapImageSource = (value: unknown): unknown =>
  isTemplateElement(value) ? value.element : value;

const wrapMethod = (target: Record<string, unknown>, name: string): void => {
  const original = target[name];
  if (typeof original !== 'function' || wrappers.has(original)) return;
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    for (let index = 0; index < args.length; index++) {
      args[index] = unwrapImageSource(args[index]);
    }
    return original.apply(this, args);
  };
  wrappers.add(wrapped);
  // As the browser's own on a prototype (enumerable there), and hidden as
  // an object's own property, so a context's keys stay the browser's.
  Object.defineProperty(target, name, {
    value: wrapped,
    writable: true,
    configurable: true,
    enumerable: Object.prototype.propertyIsEnumerable.call(target, name),
  });
};

/**
 * Wraps a context the page made for a template's `<canvas>`, by its own
 * properties: the page's prototypes are the host page's, and stay as they
 * are. The context keeps its class, so `instanceof` and every other method
 * work as before.
 */
export const wrapContextImageMethods = (context: unknown): void => {
  if (typeof context !== 'object' || context === null) return;
  for (const name of ALL_IMAGE_METHODS) {
    wrapMethod(context as Record<string, unknown>, name);
  }
};

/**
 * Wraps the main thread's own canvas classes and `createImageBitmap()`, in
 * web-core's iframe, for the canvases and bitmaps made there.
 */
export const wrapRealmImageMethods = (target: Record<string, any>): void => {
  for (const [className, names] of Object.entries(IMAGE_METHODS)) {
    const prototype = (
      target[className] as { prototype?: Record<string, unknown> } | undefined
    )?.prototype;
    if (!prototype) continue;
    for (const name of names) wrapMethod(prototype, name);
  }
  wrapMethod(target, 'createImageBitmap');
};
