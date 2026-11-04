import { LynxElement } from '../lynx-element/lynx-element';
import type { ElementRef } from '../types/lynx';
import { getWebGLBridge } from './webgl-bridge';
import {
  contextAttributesFrom,
  type LynxWebGLContextAttributes,
  LynxWebGL2RenderingContext,
} from './webgl2-context';

// A page-unique prefix for canvas ids, so two LynxViews in one app (each with
// its own JavaScript) can't pair a context with the other's canvas.
const ID_PREFIX = `c${Math.floor(Math.random() * 0x7fffffff).toString(36)}`;
let nextCanvasId = 1;
let nextContextId = 1;

/** The context's events, which the canvas fires itself (see getContext). */
const CONTEXT_EVENTS: ReadonlySet<string> = new Set([
  'webglcontextlost',
  'webglcontextrestored',
  'webglcontextcreationerror',
]);

/**
 * Frees a context's GL side when its canvas is garbage-collected, as a
 * browser frees a canvas's context with it. Angular destroying a canvas frees
 * its context at once (see releaseContext), but only for a canvas at the top
 * of the view it destroys: Angular says nothing of the elements under those.
 * Nor can the runtime free a canvas's context when the view it's shown in
 * goes, since content another view projected into it may be shown again
 * (see LynxElement.markDestroyed). Once nothing can reach the canvas, the
 * context can go. The held value names the context by id, never the canvas,
 * which would keep it alive; the shells' `destroy` ignores an id they've
 * freed already. Null where the engine has no FinalizationRegistry.
 */
const contextFinalizer: FinalizationRegistry<() => void> | null =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry((free) => free())
    : null;

type ContextListener = (event: {
  type: string;
  preventDefault(): void;
}) => void;

const kebab = (name: string): string =>
  name.startsWith('--')
    ? name
    : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * The `style` of a canvas, as three.js writes it: `canvas.style.width = '…px'`
 * sets the element's width, through the renderer path every style takes.
 */
const createStyle = (element: LynxElement): Record<string, string> => {
  const values: Record<string, string> = {};
  return new Proxy(values, {
    get: (target, name) => {
      if (name === 'setProperty') {
        return (property: string, value: string | null) => {
          target[property] = value ?? '';
          if (value === null || value === '') element.removeStyle(property);
          else element.setStyle(property, value);
        };
      }
      if (name === 'removeProperty') {
        return (property: string) => {
          const old = target[property] ?? '';
          delete target[property];
          element.removeStyle(property);
          return old;
        };
      }
      if (name === 'getPropertyValue') {
        return (property: string) => target[property] ?? '';
      }
      return typeof name === 'string' ? (target[kebab(name)] ?? '') : undefined;
    },
    set: (target, name, value) => {
      if (typeof name !== 'string') return false;
      const property = kebab(name);
      const text = value === null || value === undefined ? '' : String(value);
      target[property] = text;
      if (text === '') element.removeStyle(property);
      else element.setStyle(property, text);
      return true;
    },
  });
};

/**
 * `<canvas>`: a drawing surface with a WebGL2 context, as HTMLCanvasElement
 * has, for three.js and other WebGL libraries.
 *
 * - `width` and `height` are the drawing buffer's size in pixels (300 by 150
 *   to start, as on the web); the element's CSS size is how big it's shown.
 * - `getContext('webgl2')` returns a WebGL2RenderingContext: on iOS and
 *   Android, the runtime's (see webgl2-context.ts), drawing with the shell's
 *   OpenGL ES 3.0; on Lynx for Web, the browser's own, since the element is a
 *   real `<canvas>` there. It returns null where there's no WebGL: a host
 *   without the shell's `AngularLynxWebGL` module, such as Lynx Explorer.
 *   There's no `'2d'` context, and `'webgl'` (WebGL 1) is null too.
 * - Pointer events (see pointer-events.ts) and `getBoundingClientRect()`
 *   (see layout.ts) work on every element; a canvas keeps its layout from
 *   the start, so `clientWidth` and `clientHeight` are right after its first
 *   layout.
 * - `webglcontextlost` fires when `WEBGL_lose_context` loses the context,
 *   which three.js does when it's disposed.
 */
export class LynxCanvasElement extends LynxElement {
  readonly #canvasId = `${ID_PREFIX}-${nextCanvasId++}`;
  #width = 300;
  #height = 150;
  #context: LynxWebGL2RenderingContext | null = null;
  readonly #contextListeners = new Map<string, Set<ContextListener>>();
  readonly style: Record<string, string>;

  constructor(element: ElementRef) {
    super(element);
    this.tagName = 'canvas';
    this.style = __WEB__
      ? ((element as unknown as HTMLElement).style as unknown as Record<
          string,
          string
        >)
      : createStyle(this);
    if (!__WEB__) {
      // Pairs the native view with the context the shell makes for it.
      this.setAttribute('canvas-id', this.#canvasId);
      // Starts following its layout, so clientWidth and clientHeight are
      // right from its first layout on.
      this.getBoundingClientRect();
    }
  }

  get #dom(): HTMLCanvasElement {
    return this.element as unknown as HTMLCanvasElement;
  }

  get width(): number {
    return __WEB__ ? this.#dom.width : this.#width;
  }

  set width(value: number) {
    if (__WEB__) {
      this.#dom.width = value;
      return;
    }
    this.#width = Math.max(0, Math.floor(Number(value) || 0));
    this.#context?.resize(this.#width, this.#height);
  }

  get height(): number {
    return __WEB__ ? this.#dom.height : this.#height;
  }

  set height(value: number) {
    if (__WEB__) {
      this.#dom.height = value;
      return;
    }
    this.#height = Math.max(0, Math.floor(Number(value) || 0));
    this.#context?.resize(this.#width, this.#height);
  }

  /**
   * `width="600"` in a template, or a `[width]` binding, sizes the drawing
   * buffer, as on an HTML canvas; it's not an attribute Lynx knows.
   */
  override setAttribute(name: string, value: any): void {
    if (!__WEB__ && (name === 'width' || name === 'height')) {
      this[name] = Number(value);
      return;
    }
    super.setAttribute(name, value);
  }

  override setProperty(name: string, value: any): void {
    if (name === 'width' || name === 'height') {
      this[name] = Number(value);
      return;
    }
    super.setProperty(name, value);
  }

  /**
   * The id that pairs this canvas with its native view and GL context.
   */
  get canvasId(): string {
    return this.#canvasId;
  }

  getContext(
    type: string,
    attributes?: Partial<LynxWebGLContextAttributes>,
  ): unknown {
    if (__WEB__) {
      return this.#dom.getContext(type, attributes as WebGLContextAttributes);
    }
    if (type !== 'webgl2') return null;
    if (this.#context && !this.#context.isContextLost()) return this.#context;
    const bridge = getWebGLBridge();
    if (!bridge) {
      this.dispatchContextEvent('webglcontextcreationerror');
      return null;
    }
    const contextId = nextContextId++;
    const resolved = contextAttributesFrom(attributes);
    const created = bridge.create(contextId, this.#canvasId, {
      ...resolved,
      width: this.#width,
      height: this.#height,
    });
    if (!created.ok) {
      console.warn(`[angular-lynx] No WebGL2 on this canvas: ${created.error}`);
      this.dispatchContextEvent('webglcontextcreationerror');
      return null;
    }
    this.#context = new LynxWebGL2RenderingContext(
      bridge,
      contextId,
      this,
      resolved,
    );
    contextFinalizer?.register(this, () => bridge.destroy(contextId));
    return this.#context;
  }

  override addEventListener(name: string, cb: (event: any) => any) {
    if (!__WEB__ && CONTEXT_EVENTS.has(name)) {
      let listeners = this.#contextListeners.get(name);
      if (!listeners) {
        listeners = new Set();
        this.#contextListeners.set(name, listeners);
      }
      listeners.add(cb);
      return () => listeners.delete(cb);
    }
    return super.addEventListener(name, cb);
  }

  override removeEventListener(name: string, cb: (event: any) => any): void {
    if (!__WEB__ && CONTEXT_EVENTS.has(name)) {
      this.#contextListeners.get(name)?.delete(cb);
      return;
    }
    super.removeEventListener(name, cb);
  }

  /**
   * @internal Fires one of the context's events; false if one prevented it.
   */
  dispatchContextEvent(type: string): boolean {
    let prevented = false;
    const event = {
      type,
      target: this,
      currentTarget: this,
      statusMessage: '',
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {},
    };
    // A copy: a listener may remove itself as it runs.
    for (const listener of Array.from(this.#contextListeners.get(type) ?? [])) {
      listener(event);
    }
    return !prevented;
  }

  /**
   * @internal Angular destroyed the element: the GL context goes with it.
   */
  releaseContext(): void {
    this.#context?.destroy();
    this.#context = null;
  }

  toDataURL(): string {
    throw new Error(
      'canvas.toDataURL() is not available on Lynx: read the pixels with readPixels()',
    );
  }

  toBlob(): void {
    throw new Error(
      'canvas.toBlob() is not available on Lynx: read the pixels with readPixels()',
    );
  }
}
