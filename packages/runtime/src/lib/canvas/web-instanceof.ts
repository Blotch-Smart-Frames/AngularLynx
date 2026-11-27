/**
 * `instanceof` in the web preview, answering as it does on iOS and Android
 * for a template's elements and the canvas contexts they make.
 *
 * Lynx for Web runs the main thread, and so Angular, in a hidden iframe
 * (web-core's createIFrameRealm), while the elements it shows are the page's:
 * a template's `<canvas>` is AngularLynx's element around the page's DOM
 * canvas, whose contexts, gradients and image data are the page's too. The
 * iframe has its own HTMLCanvasElement, CanvasRenderingContext2D and so on,
 * which `installCanvasGlobals` leaves in place, and an `instanceof` against
 * one of them walks only the iframe's prototypes. So `video instanceof
 * HTMLVideoElement` was false for a template's `<video>`, which three.js
 * sizes a VideoTexture by, and `ctx instanceof CanvasRenderingContext2D` for
 * its canvas's context. On a phone, the runtime's classes recognize both.
 */

/**
 * The classes whose instances can come from the page: the element classes a
 * template's elements stand for, and what a page canvas's contexts return.
 * They're the ones `installCanvasGlobals` puts in place on Lynx, where the
 * runtime's recognize their instances. Those made only in the iframe
 * (OffscreenCanvas, Path2D, ImageBitmap) are left alone.
 */
const PAGE_CLASSES: readonly string[] = [
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLVideoElement',
  'CanvasRenderingContext2D',
  'WebGLRenderingContext',
  'WebGL2RenderingContext',
  'CanvasGradient',
  'CanvasPattern',
  'ImageData',
  'TextMetrics',
];

/**
 * Marks a class already given its Symbol.hasInstance, so a second install
 * (a reload of the runtime in the same iframe) doesn't wrap it again.
 */
const ACCEPTS_PAGE_INSTANCES = Symbol.for('angular-lynx.acceptsPageInstances');

/**
 * What `instanceof` does without an own Symbol.hasInstance: walk the value's
 * prototype chain for the class's prototype.
 */
const isOwnInstance = Function.prototype[Symbol.hasInstance];

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

type Realm = Record<string, unknown>;

/**
 * The realms other than the iframe's that the value may come from: a DOM
 * node's window, and the window web-core runs in, which made the iframe and
 * the page's elements. A context, gradient or image data has no link to its
 * window, so the parent is the one to ask for those.
 */
const foreignRealms = (value: object, target: Realm): Realm[] => {
  const realms: Realm[] = [];
  const view = (value as { ownerDocument?: { defaultView?: Realm | null } })
    .ownerDocument?.defaultView;
  if (view && view !== target) realms.push(view);
  const parent = target['parent'] as Realm | undefined;
  if (parent && parent !== target && parent !== view) realms.push(parent);
  return realms;
};

/**
 * Whether the value is an instance of the realm's class of this name. A
 * window of another origin throws on any read, and holds none of the page's
 * objects.
 */
const isRealmInstance = (realm: Realm, name: string, value: object) => {
  try {
    const Class = realm[name];
    return typeof Class === 'function' && isOwnInstance.call(Class, value);
  } catch {
    return false;
  }
};

const acceptPageInstancesOf = (target: Realm, name: string): void => {
  const Class = target[name];
  // Its own mark: HTMLCanvasElement and HTMLVideoElement inherit
  // HTMLElement's statics, the mark with them.
  if (
    typeof Class !== 'function' ||
    Object.hasOwn(Class, ACCEPTS_PAGE_INSTANCES)
  ) {
    return;
  }
  // What the class took before: the prototype walk for the browser's own
  // (Element's check, for HTMLElement, which asks it of HTMLElement), and the
  // runtime's check where the realm had none and installCanvasGlobals put
  // the runtime's class in. Either way it keeps taking all it took.
  const takes = Class[Symbol.hasInstance] as (
    this: unknown,
    value: unknown,
  ) => boolean;
  Object.defineProperty(Class, Symbol.hasInstance, {
    value(this: unknown, value: unknown): boolean {
      if (takes.call(this, value)) return true;
      // The DOM's subclasses inherit HTMLElement's static methods, this one
      // with them, so `this` says which class is asking: only the class
      // itself takes the page's instances, as on Lynx, where none of its
      // subclasses exist.
      if (this !== Class) return false;
      // A template's element is an instance of the class its DOM element is
      // of: a `<video>`'s is the page's video, a `<view>`'s an HTMLElement.
      const source = isTemplateElement(value) ? value.element : value;
      if (typeof source !== 'object' || source === null) return false;
      return foreignRealms(source, target).some((realm) =>
        isRealmInstance(realm, name, source),
      );
    },
    configurable: true,
  });
  Object.defineProperty(Class, ACCEPTS_PAGE_INSTANCES, {
    value: true,
    configurable: true,
  });
};

/**
 * Gives the iframe's element and canvas classes a Symbol.hasInstance that
 * also takes a template's element and the page's instances (see above).
 */
export const acceptPageInstances = (target: Realm): void => {
  for (const name of PAGE_CLASSES) acceptPageInstancesOf(target, name);
};
