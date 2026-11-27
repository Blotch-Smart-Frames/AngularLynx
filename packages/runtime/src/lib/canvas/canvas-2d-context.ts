// cspell:words arities Skia
import { fromWords, toWords } from '../network/words';
import {
  COMPOSITE_OPERATIONS,
  DIRECTIONS,
  LINE_CAPS,
  LINE_JOINS,
  OP,
  PATTERN_REPETITIONS,
  SMOOTHING_QUALITIES,
  TEXT_ALIGNS,
  TEXT_BASELINES,
} from './canvas-2d-ops';
import { canvasSourceOf } from './canvas-source';
import { type RGBA, parseColor, serializeColor } from './css-color';
import { parseFilter } from './css-filter';
import { type CanvasFont, DEFAULT_FONT, parseFont } from './css-font';
import { nativeImageOf } from './native-image';
import { markBatchPending, markBatchSent } from './pending-batches';
import {
  IDENTITY,
  LynxPath2D,
  type Matrix,
  type MatrixInit,
  PathBuilder,
  type RadiusInit,
  invert,
  matrixFrom,
  multiply,
  transformSegments,
} from './path';
import type { Canvas2DBridge, EncodedImage } from './webgl-bridge';
import type { LynxCanvas2DAttributes } from './canvas-2d-attributes';
import { LynxImageData } from './image-data';

/** The canvas a 2D context draws on, as the context sees it. */
export type Canvas2DHost = {
  readonly width: number;
  readonly height: number;
};

const domError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

const finite = (...values: number[]): boolean =>
  values.every((value) => Number.isFinite(value));

/**
 * Web IDL's `[EnforceRange] long`, which the pixel methods take: truncated
 * toward zero, and a TypeError for a value that's not finite or out of
 * range.
 */
const enforceLong = (value: unknown, method: string): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(
      `Failed to execute '${method}' on 'CanvasRenderingContext2D': The provided double value is non-finite.`,
    );
  }
  const truncated = Math.trunc(number) || 0;
  if (truncated < -2147483648 || truncated > 2147483647) {
    throw new TypeError(
      `Failed to execute '${method}' on 'CanvasRenderingContext2D': Value is outside the 'long' value range.`,
    );
  }
  return truncated;
};

type Style =
  | { readonly kind: 'color'; readonly rgba: RGBA }
  | { readonly kind: 'gradient'; readonly gradient: LynxCanvasGradient }
  | { readonly kind: 'pattern'; readonly pattern: LynxCanvasPattern };

const BLACK: Style = { kind: 'color', rgba: [0, 0, 0, 1] };

/** The drawing state `save()` keeps and `restore()` gives back. */
type State = {
  transform: Matrix;
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: Style;
  strokeStyle: Style;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  miterLimit: number;
  lineDash: number[];
  lineDashOffset: number;
  shadowBlur: number;
  shadowColor: RGBA;
  shadowOffsetX: number;
  shadowOffsetY: number;
  font: CanvasFont;
  textAlign: string;
  textBaseline: string;
  direction: string;
  letterSpacing: string;
  letterSpacingPixels: number;
  wordSpacing: string;
  fontKerning: string;
  fontStretch: string;
  fontVariantCaps: string;
  textRendering: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  filter: string;
};

const initialState = (): State => ({
  transform: IDENTITY,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  fillStyle: BLACK,
  strokeStyle: BLACK,
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  lineDash: [],
  lineDashOffset: 0,
  shadowBlur: 0,
  shadowColor: [0, 0, 0, 0],
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  font: DEFAULT_FONT,
  textAlign: 'start',
  textBaseline: 'alphabetic',
  direction: 'inherit',
  letterSpacing: '0px',
  letterSpacingPixels: 0,
  wordSpacing: '0px',
  fontKerning: 'auto',
  fontStretch: 'normal',
  fontVariantCaps: 'normal',
  textRendering: 'auto',
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
  filter: 'none',
});

/** What a context gives the patterns it makes. */
type ObjectOwner = {
  /** Sends what's recorded: another context is about to use the object. */
  flush(): void;
};

/**
 * Frees a gradient's or pattern's native side when it's garbage-collected.
 * The shells keep every context's objects together, so it goes to the
 * module straight, not through the context that made it, which may be gone.
 * The held value holds no context, which would keep it alive. Null where the
 * engine has no FinalizationRegistry.
 */
const objectFinalizer: FinalizationRegistry<{
  bridge: Canvas2DBridge;
  id: number;
}> | null =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry(({ bridge, id }) => bridge.release2D(id))
    : null;

/**
 * Gradients' and patterns' ids, unique for the page: the shells keep the
 * objects for every context together, so a gradient one context made can
 * paint in another, as on the web.
 */
let nextObjectId = 1;

/**
 * CanvasGradient: made by the context's create*Gradient(). It lives here,
 * not in the shell: a context that paints with it sends it whole with the
 * style, as it is at the draw, so a gradient one context made paints in any
 * other, and a stop added later reaches every draw after it, in order.
 */
export class LynxCanvasGradient {
  /** @internal 0 linear, 1 radial, 2 conic. */
  readonly type: number;
  /** @internal Its points, radii and angle, six numbers. */
  readonly params: readonly number[];
  /** @internal Offset, red, green, blue and alpha of each stop, in order. */
  readonly stops: number[] = [];
  /** @internal Counts its changes, so a context knows to send it again. */
  version = 0;

  /**
   * @internal
   */
  constructor(type: number, params: readonly number[]) {
    this.type = type;
    this.params = [...params, 0, 0, 0, 0, 0, 0].slice(0, 6);
  }

  addColorStop(offset: number, color: string): void {
    const value = Number(offset);
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Failed to execute 'addColorStop' on 'CanvasGradient': The provided double value is non-finite.",
      );
    }
    if (value < 0 || value > 1) {
      throw domError(
        'IndexSizeError',
        `Failed to execute 'addColorStop' on 'CanvasGradient': The provided value (${value}) is outside the range (0.0, 1.0).`,
      );
    }
    const rgba = parseColor(color);
    if (!rgba) {
      throw domError(
        'SyntaxError',
        `Failed to execute 'addColorStop' on 'CanvasGradient': The value provided ('${color}') could not be parsed as a color.`,
      );
    }
    // After the stops at the same offset, as the spec has it, so two at one
    // offset make a hard edge.
    let index = this.stops.length;
    while (index > 0 && this.stops[index - 5] > value) index -= 5;
    this.stops.splice(index, 0, value, ...rgba);
    this.version++;
  }
}

/**
 * CanvasPattern: made by the context's createPattern(). Its image is the
 * shell's, made once and never changed; its transform lives here, and a
 * context that paints with it sends it with the style, as it is at the draw.
 */
export class LynxCanvasPattern {
  readonly #owner: ObjectOwner;
  /** @internal The shell's id for its image. */
  readonly id: number;
  /** @internal */
  transform: Matrix = IDENTITY;
  /** @internal Counts its changes, so a context knows to send it again. */
  version = 0;

  /**
   * @internal
   */
  constructor(owner: ObjectOwner, id: number) {
    this.#owner = owner;
    this.id = id;
  }

  /**
   * @internal Sends the calls of the context that made it, which made its
   * image in the shell, before another context uses it.
   */
  flushOwner(owner: unknown): void {
    if (owner !== this.#owner) this.#owner.flush();
  }

  setTransform(transform?: MatrixInit): void {
    const m = matrixFrom(transform);
    if (!finite(...m)) return;
    this.transform = m;
    this.version++;
  }
}

/** TextMetrics: what measureText() returns. */
export class LynxTextMetrics {
  readonly width: number;
  readonly actualBoundingBoxLeft: number;
  readonly actualBoundingBoxRight: number;
  readonly fontBoundingBoxAscent: number;
  readonly fontBoundingBoxDescent: number;
  readonly actualBoundingBoxAscent: number;
  readonly actualBoundingBoxDescent: number;
  readonly emHeightAscent: number;
  readonly emHeightDescent: number;
  readonly hangingBaseline: number;
  readonly alphabeticBaseline: number;
  readonly ideographicBaseline: number;

  /**
   * @internal
   */
  constructor(values: readonly number[]) {
    const at = (index: number) => Number(values[index] ?? 0);
    this.width = at(0);
    this.actualBoundingBoxLeft = at(1);
    this.actualBoundingBoxRight = at(2);
    this.fontBoundingBoxAscent = at(3);
    this.fontBoundingBoxDescent = at(4);
    this.actualBoundingBoxAscent = at(5);
    this.actualBoundingBoxDescent = at(6);
    this.emHeightAscent = at(7);
    this.emHeightDescent = at(8);
    this.hangingBaseline = at(9);
    this.alphabeticBaseline = at(10);
    this.ideographicBaseline = at(11);
  }
}

/**
 * The matrix getTransform() returns: the browser's DOMMatrix where there is
 * one, and otherwise this, with DOMMatrix's 2D members.
 */
export class LynxDOMMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  readonly is2D = true;

  constructor(init: readonly number[] = [1, 0, 0, 1, 0, 0]) {
    [this.a, this.b, this.c, this.d, this.e, this.f] = init;
  }

  get m11(): number {
    return this.a;
  }
  get m12(): number {
    return this.b;
  }
  get m21(): number {
    return this.c;
  }
  get m22(): number {
    return this.d;
  }
  get m41(): number {
    return this.e;
  }
  get m42(): number {
    return this.f;
  }
  get isIdentity(): boolean {
    return (
      this.a === 1 &&
      this.b === 0 &&
      this.c === 0 &&
      this.d === 1 &&
      this.e === 0 &&
      this.f === 0
    );
  }

  #values(): Matrix {
    return [this.a, this.b, this.c, this.d, this.e, this.f];
  }

  multiply(other: MatrixInit): LynxDOMMatrix {
    return new LynxDOMMatrix(multiply(this.#values(), matrixFrom(other)));
  }
  translate(x = 0, y = 0): LynxDOMMatrix {
    return new LynxDOMMatrix(multiply(this.#values(), [1, 0, 0, 1, x, y]));
  }
  scale(scaleX = 1, scaleY = scaleX): LynxDOMMatrix {
    return new LynxDOMMatrix(
      multiply(this.#values(), [scaleX, 0, 0, scaleY, 0, 0]),
    );
  }
  rotate(degrees = 0): LynxDOMMatrix {
    const angle = (degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new LynxDOMMatrix(
      multiply(this.#values(), [cos, sin, -sin, cos, 0, 0]),
    );
  }
  inverse(): LynxDOMMatrix {
    return new LynxDOMMatrix(
      invert(this.#values()) ?? [NaN, NaN, NaN, NaN, NaN, NaN],
    );
  }
  transformPoint(point: { x?: number; y?: number } = {}): {
    x: number;
    y: number;
    z: number;
    w: number;
  } {
    const x = point.x ?? 0;
    const y = point.y ?? 0;
    return {
      x: this.a * x + this.c * y + this.e,
      y: this.b * x + this.d * y + this.f,
      z: 0,
      w: 1,
    };
  }
  toString(): string {
    return `matrix(${this.#values().join(', ')})`;
  }
}

const matrixObject = (m: Matrix): unknown => {
  const DOMMatrixClass = (
    globalThis as { DOMMatrix?: new (init: number[]) => unknown }
  ).DOMMatrix;
  return typeof DOMMatrixClass === 'function'
    ? new DOMMatrixClass([...m])
    : new LynxDOMMatrix(m);
};

type ImageSource = {
  /** What the shell reads: `{ image }` for decoded pixels, `{ canvas }` for a canvas. */
  readonly descriptor: Record<string, unknown>;
  readonly width: number;
  readonly height: number;
  /** A canvas, whose calls are sent first and the use right after. */
  readonly flush?: () => void;
};

const FILL_RULES = ['nonzero', 'evenodd'];

/**
 * `<canvas>`'s `getContext('2d')` on Lynx: the CanvasRenderingContext2D API
 * chart, signature-pad and image libraries draw with, and three.js draws
 * labels with for a CanvasTexture. The shell draws with the platform's own
 * 2D graphics, Core Graphics on iOS and `android.graphics.Canvas` (Skia) on
 * Android, the engines Safari's and Chrome's canvases draw with, into a
 * bitmap at the canvas's `width` and `height`, which it shows in the
 * canvas's view after each task that drew.
 *
 * As the WebGL context does, it records the calls and sends them in one
 * `run2D` at the end of the task, or when a call needs an answer
 * (`measureText()`, `getImageData()`, `isPointInPath()`). So it keeps
 * everything a getter answers itself: the state (`fillStyle`, `font`, the
 * transform), and the current path, built here in the canvas's pixels as the
 * spec has it (see path.ts).
 *
 * Not there: the text properties
 * Lynx's shells don't draw (`wordSpacing`, `fontKerning`, `fontStretch`,
 * `fontVariantCaps`, `textRendering` are kept and ignored), and focus rings (`drawFocusIfNeeded()` does nothing).
 */
export class LynxCanvasRenderingContext2D {
  readonly canvas: Canvas2DHost;

  readonly #bridge: Canvas2DBridge;
  readonly #id: number;
  readonly #attributes: LynxCanvas2DAttributes;
  #commands: unknown[] = [];
  #flushScheduled = false;
  /**
   * Sends what's recorded: what an ImageBitmap calls before the shell lets go
   * of its pixels (see pending-batches.ts).
   */
  readonly #sendPending = (): unknown => this.#send();
  /** Something was drawn since the last present. */
  #dirty = false;
  #destroyed = false;

  #state: State = initialState();
  #stack: State[] = [];
  readonly #path = new PathBuilder();
  readonly #owner: ObjectOwner;

  /**
   * @internal Made by a canvas's getContext('2d').
   */
  constructor(
    bridge: Canvas2DBridge,
    contextId: number,
    canvas: Canvas2DHost,
    attributes: LynxCanvas2DAttributes,
  ) {
    this.#bridge = bridge;
    this.#id = contextId;
    this.canvas = canvas;
    this.#attributes = attributes;
    this.#owner = { flush: () => this.flush() };
  }

  /**
   * --- The batch -----------------------------------------------------------
   */

  #cmd(...items: unknown[]): void {
    if (this.#destroyed) return;
    for (const item of items) this.#commands.push(item);
    this.#scheduleFlush();
  }

  #draw(...items: unknown[]): void {
    // A gradient or pattern that changed since it was sent (a stop, a
    // transform) is sent again, in this context's batch, so the draw uses it
    // as it is now and the draws before it as they were.
    this.#sendStyleIfChanged(this.#state.fillStyle, true);
    this.#sendStyleIfChanged(this.#state.strokeStyle, false);
    this.#dirty = true;
    this.#cmd(...items);
  }

  #scheduleFlush(): void {
    markBatchPending(this.#sendPending);
    if (this.#commands.length > 65536) {
      this.#send();
      return;
    }
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    queueMicrotask(() => this.#endOfTask());
  }

  /**
   * At the end of the task that drew, as a browser shows a canvas after the
   * task that drew to it: send the calls, and show the bitmap.
   */
  #endOfTask(): void {
    this.#flushScheduled = false;
    if (this.#destroyed) return;
    if (this.#dirty) {
      this.#dirty = false;
      this.#commands.push(OP.present);
    }
    this.#send();
  }

  #send(): unknown[] {
    markBatchSent(this.#sendPending);
    if (this.#commands.length === 0) return [];
    const commands = this.#commands;
    this.#commands = [];
    return this.#bridge.run2D(this.#id, commands);
  }

  #query(...items: unknown[]): unknown {
    if (this.#destroyed) return null;
    for (const item of items) this.#commands.push(item);
    const results = this.#send();
    return results[results.length - 1] ?? null;
  }

  /**
   * @internal Sends what's recorded, so the shell can read the canvas.
   */
  flush(): void {
    if (!this.#destroyed) this.#send();
  }

  /**
   * @internal The canvas changed size: its bitmap is cleared, its state reset.
   */
  resize(width: number, height: number): void {
    this.#resetState();
    this.#cmd(OP.resize, width, height);
    this.#dirty = true;
  }

  /**
   * @internal The canvas went: so does the shell's bitmap.
   */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#commands = [];
    markBatchSent(this.#sendPending);
    this.#bridge.destroy2D(this.#id);
  }

  /**
   * @internal For canvas.toBlob() and toDataURL().
   */
  encode(type: string, quality: number): EncodedImage {
    if (this.#destroyed) return { error: 'The canvas has no 2D context' };
    this.#send();
    return this.#bridge.encode2D(this.#id, { type, quality });
  }

  #resetState(): void {
    this.#state = initialState();
    this.#stack = [];
    this.#path.clear();
    this.#path.matrix = IDENTITY;
  }

  getContextAttributes(): LynxCanvas2DAttributes {
    return { ...this.#attributes };
  }

  isContextLost(): boolean {
    return false;
  }

  /**
   * --- State ---------------------------------------------------------------
   */

  save(): void {
    this.#stack.push({ ...this.#state, lineDash: [...this.#state.lineDash] });
    this.#cmd(OP.save);
  }

  restore(): void {
    const state = this.#stack.pop();
    if (!state) return;
    this.#state = state;
    this.#path.matrix = state.transform;
    this.#cmd(OP.restore);
    // The shell's styles are the saved ones now, of whichever version was
    // sent then: the next draw sends them again if they've changed.
    this.#sentVersion = { fill: -1, stroke: -1 };
  }

  reset(): void {
    this.#resetState();
    this.#draw(OP.reset);
  }

  /**
   * --- Transforms ----------------------------------------------------------
   */

  #setTransform(matrix: Matrix): void {
    if (!finite(...matrix)) return;
    this.#state.transform = matrix;
    this.#path.matrix = matrix;
    this.#cmd(OP.setTransform, ...matrix);
  }

  scale(x: number, y: number): void {
    if (!finite(x, y)) return;
    this.#setTransform(multiply(this.#state.transform, [x, 0, 0, y, 0, 0]));
  }

  rotate(angle: number): void {
    if (!finite(angle)) return;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.#setTransform(
      multiply(this.#state.transform, [cos, sin, -sin, cos, 0, 0]),
    );
  }

  translate(x: number, y: number): void {
    if (!finite(x, y)) return;
    this.#setTransform(multiply(this.#state.transform, [1, 0, 0, 1, x, y]));
  }

  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    if (!finite(a, b, c, d, e, f)) return;
    this.#setTransform(multiply(this.#state.transform, [a, b, c, d, e, f]));
  }

  setTransform(
    a?: number | MatrixInit,
    b?: number,
    c?: number,
    d?: number,
    e?: number,
    f?: number,
  ): void {
    if (typeof a === 'number') {
      const values = [a, b, c, d, e, f].map(Number) as unknown as Matrix;
      this.#setTransform(values);
      return;
    }
    this.#setTransform(matrixFrom(a));
  }

  resetTransform(): void {
    this.#setTransform(IDENTITY);
  }

  getTransform(): unknown {
    return matrixObject(this.#state.transform);
  }

  /**
   * --- Compositing ---------------------------------------------------------
   */

  get globalAlpha(): number {
    return this.#state.globalAlpha;
  }
  set globalAlpha(value: number) {
    const alpha = Number(value);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return;
    this.#state.globalAlpha = alpha;
    this.#cmd(OP.setGlobalAlpha, alpha);
  }

  get globalCompositeOperation(): string {
    return this.#state.globalCompositeOperation;
  }
  set globalCompositeOperation(value: string) {
    const index = COMPOSITE_OPERATIONS.indexOf(String(value) as never);
    if (index < 0) return;
    this.#state.globalCompositeOperation = COMPOSITE_OPERATIONS[index];
    this.#cmd(OP.setCompositeOperation, index);
  }

  get imageSmoothingEnabled(): boolean {
    return this.#state.imageSmoothingEnabled;
  }
  set imageSmoothingEnabled(value: boolean) {
    this.#state.imageSmoothingEnabled = !!value;
    this.#sendSmoothing();
  }

  get imageSmoothingQuality(): string {
    return this.#state.imageSmoothingQuality;
  }
  set imageSmoothingQuality(value: string) {
    if (!SMOOTHING_QUALITIES.includes(value as never)) return;
    this.#state.imageSmoothingQuality = value;
    this.#sendSmoothing();
  }

  #sendSmoothing(): void {
    this.#cmd(
      OP.setImageSmoothing,
      this.#state.imageSmoothingEnabled ? 1 : 0,
      SMOOTHING_QUALITIES.indexOf(this.#state.imageSmoothingQuality as never),
    );
  }

  get filter(): string {
    return this.#state.filter;
  }
  set filter(value: string) {
    // Parsed here, as `font` is, so the shells get the steps they apply to
    // what's drawn (see css-filter.ts). A string that isn't a filter is
    // ignored, as in browsers; the getter gives back the string as it was set.
    const filter = parseFilter(value);
    if (!filter) return;
    this.#state.filter = String(value);
    this.#cmd(OP.setFilter, filter.padding, filter.steps.slice());
  }

  /**
   * --- Fill and stroke styles ----------------------------------------------
   */

  #styleValue(style: Style): string | LynxCanvasGradient | LynxCanvasPattern {
    switch (style.kind) {
      case 'color':
        return serializeColor(style.rgba);
      case 'gradient':
        return style.gradient;
      default:
        return style.pattern;
    }
  }

  #styleFrom(value: unknown): Style | null {
    if (value instanceof LynxCanvasGradient) {
      return { kind: 'gradient', gradient: value };
    }
    if (value instanceof LynxCanvasPattern) {
      value.flushOwner(this.#owner);
      return { kind: 'pattern', pattern: value };
    }
    const rgba = parseColor(value);
    return rgba ? { kind: 'color', rgba } : null;
  }

  /** The version of each style's gradient or pattern the shell has. */
  #sentVersion = { fill: -1, stroke: -1 };

  #sendStyle(style: Style, fill: boolean): void {
    switch (style.kind) {
      case 'color':
        this.#cmd(fill ? OP.setFillColor : OP.setStrokeColor, ...style.rgba);
        return;
      case 'gradient': {
        const { gradient } = style;
        this.#cmd(
          fill ? OP.setFillGradient : OP.setStrokeGradient,
          gradient.type,
          ...gradient.params,
          gradient.stops.slice(),
        );
        this.#sentVersion[fill ? 'fill' : 'stroke'] = gradient.version;
        return;
      }
      default: {
        const { pattern } = style;
        this.#cmd(
          fill ? OP.setFillPattern : OP.setStrokePattern,
          pattern.id,
          ...pattern.transform,
        );
        this.#sentVersion[fill ? 'fill' : 'stroke'] = pattern.version;
      }
    }
  }

  #sendStyleIfChanged(style: Style, fill: boolean): void {
    if (style.kind === 'color') return;
    const version =
      style.kind === 'gradient'
        ? style.gradient.version
        : style.pattern.version;
    if (version !== this.#sentVersion[fill ? 'fill' : 'stroke']) {
      this.#sendStyle(style, fill);
    }
  }

  get fillStyle(): string | LynxCanvasGradient | LynxCanvasPattern {
    return this.#styleValue(this.#state.fillStyle);
  }
  set fillStyle(value: string | LynxCanvasGradient | LynxCanvasPattern) {
    const style = this.#styleFrom(value);
    if (!style) return;
    this.#state.fillStyle = style;
    this.#sendStyle(style, true);
  }

  get strokeStyle(): string | LynxCanvasGradient | LynxCanvasPattern {
    return this.#styleValue(this.#state.strokeStyle);
  }
  set strokeStyle(value: string | LynxCanvasGradient | LynxCanvasPattern) {
    const style = this.#styleFrom(value);
    if (!style) return;
    this.#state.strokeStyle = style;
    this.#sendStyle(style, false);
  }

  #newObjectId(): number {
    return nextObjectId++;
  }

  #track(object: object, id: number): void {
    objectFinalizer?.register(object, { bridge: this.#bridge, id });
  }

  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): LynxCanvasGradient {
    const values = [x0, y0, x1, y1].map(Number);
    if (!finite(...values)) {
      throw new TypeError(
        "Failed to execute 'createLinearGradient' on 'CanvasRenderingContext2D': The provided double value is non-finite.",
      );
    }
    return new LynxCanvasGradient(0, values);
  }

  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): LynxCanvasGradient {
    const values = [x0, y0, r0, x1, y1, r1].map(Number);
    if (!finite(...values)) {
      throw new TypeError(
        "Failed to execute 'createRadialGradient' on 'CanvasRenderingContext2D': The provided double value is non-finite.",
      );
    }
    if (values[2] < 0 || values[5] < 0) {
      throw domError(
        'IndexSizeError',
        `Failed to execute 'createRadialGradient' on 'CanvasRenderingContext2D': The ${values[2] < 0 ? 'r0' : 'r1'} provided is less than 0.`,
      );
    }
    return new LynxCanvasGradient(1, values);
  }

  createConicGradient(
    startAngle: number,
    x: number,
    y: number,
  ): LynxCanvasGradient {
    const values = [startAngle, x, y].map(Number);
    if (!finite(...values)) {
      throw new TypeError(
        "Failed to execute 'createConicGradient' on 'CanvasRenderingContext2D': The provided double value is non-finite.",
      );
    }
    return new LynxCanvasGradient(2, values);
  }

  createPattern(
    image: unknown,
    repetition: string | null,
  ): LynxCanvasPattern | null {
    const mode =
      repetition === null || repetition === '' ? 'repeat' : String(repetition);
    const index = PATTERN_REPETITIONS.indexOf(mode as never);
    if (index < 0) {
      throw domError(
        'SyntaxError',
        `Failed to execute 'createPattern' on 'CanvasRenderingContext2D': The provided type ('${mode}') is not one of 'repeat', 'no-repeat', 'repeat-x', or 'repeat-y'.`,
      );
    }
    const source = this.#imageSource(image, 'createPattern');
    if (!source) return null;
    const id = this.#newObjectId();
    source.flush?.();
    this.#cmd(OP.createPattern, id, source.descriptor, index);
    // A pattern of a canvas is of the canvas as it is now.
    if (source.flush) this.#send();
    const pattern = new LynxCanvasPattern(this.#owner, id);
    this.#track(pattern, id);
    return pattern;
  }

  /**
   * --- Shadows -------------------------------------------------------------
   */

  #sendShadow(): void {
    const s = this.#state;
    this.#cmd(
      OP.setShadow,
      s.shadowBlur,
      ...s.shadowColor,
      s.shadowOffsetX,
      s.shadowOffsetY,
    );
  }

  get shadowBlur(): number {
    return this.#state.shadowBlur;
  }
  set shadowBlur(value: number) {
    const blur = Number(value);
    if (!Number.isFinite(blur) || blur < 0) return;
    this.#state.shadowBlur = blur;
    this.#sendShadow();
  }

  get shadowColor(): string {
    return serializeColor(this.#state.shadowColor);
  }
  set shadowColor(value: string) {
    const rgba = parseColor(value);
    if (!rgba) return;
    this.#state.shadowColor = rgba;
    this.#sendShadow();
  }

  get shadowOffsetX(): number {
    return this.#state.shadowOffsetX;
  }
  set shadowOffsetX(value: number) {
    const offset = Number(value);
    if (!Number.isFinite(offset)) return;
    this.#state.shadowOffsetX = offset;
    this.#sendShadow();
  }

  get shadowOffsetY(): number {
    return this.#state.shadowOffsetY;
  }
  set shadowOffsetY(value: number) {
    const offset = Number(value);
    if (!Number.isFinite(offset)) return;
    this.#state.shadowOffsetY = offset;
    this.#sendShadow();
  }

  /**
   * --- Line styles ---------------------------------------------------------
   */

  get lineWidth(): number {
    return this.#state.lineWidth;
  }
  set lineWidth(value: number) {
    const width = Number(value);
    if (!Number.isFinite(width) || width <= 0) return;
    this.#state.lineWidth = width;
    this.#cmd(OP.setLineWidth, width);
  }

  get lineCap(): string {
    return this.#state.lineCap;
  }
  set lineCap(value: string) {
    const index = LINE_CAPS.indexOf(value as never);
    if (index < 0) return;
    this.#state.lineCap = LINE_CAPS[index];
    this.#cmd(OP.setLineCap, index);
  }

  get lineJoin(): string {
    return this.#state.lineJoin;
  }
  set lineJoin(value: string) {
    const index = LINE_JOINS.indexOf(value as never);
    if (index < 0) return;
    this.#state.lineJoin = LINE_JOINS[index];
    this.#cmd(OP.setLineJoin, index);
  }

  get miterLimit(): number {
    return this.#state.miterLimit;
  }
  set miterLimit(value: number) {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit <= 0) return;
    this.#state.miterLimit = limit;
    this.#cmd(OP.setMiterLimit, limit);
  }

  setLineDash(segments: number[]): void {
    const values = Array.from(segments ?? [], Number);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) return;
    // An odd list is repeated to make it even, as the spec has it.
    const dash = values.length % 2 === 1 ? [...values, ...values] : values;
    this.#state.lineDash = dash;
    this.#sendDash();
  }

  getLineDash(): number[] {
    return [...this.#state.lineDash];
  }

  get lineDashOffset(): number {
    return this.#state.lineDashOffset;
  }
  set lineDashOffset(value: number) {
    const offset = Number(value);
    if (!Number.isFinite(offset)) return;
    this.#state.lineDashOffset = offset;
    this.#sendDash();
  }

  #sendDash(): void {
    // A dash of nothing but gaps draws as a solid line in browsers: a list
    // of zeros is no dash.
    const dash = this.#state.lineDash.some((value) => value > 0)
      ? this.#state.lineDash
      : [];
    this.#cmd(OP.setLineDash, dash, this.#state.lineDashOffset);
  }

  /**
   * --- Text styles ---------------------------------------------------------
   */

  get font(): string {
    return this.#state.font.text;
  }
  set font(value: string) {
    const font = parseFont(value);
    if (!font) return;
    this.#state.font = font;
    this.#cmd(
      OP.setFont,
      font.italic ? 1 : 0,
      font.weight,
      font.size,
      font.families.join('\n'),
    );
    // An `em` letter spacing follows the font's size.
    if (this.#state.letterSpacing.endsWith('em')) {
      this.letterSpacing = this.#state.letterSpacing;
    }
  }

  get textAlign(): string {
    return this.#state.textAlign;
  }
  set textAlign(value: string) {
    const index = TEXT_ALIGNS.indexOf(value as never);
    if (index < 0) return;
    this.#state.textAlign = TEXT_ALIGNS[index];
    this.#cmd(OP.setTextAlign, index);
  }

  get textBaseline(): string {
    return this.#state.textBaseline;
  }
  set textBaseline(value: string) {
    const index = TEXT_BASELINES.indexOf(value as never);
    if (index < 0) return;
    this.#state.textBaseline = TEXT_BASELINES[index];
    this.#cmd(OP.setTextBaseline, index);
  }

  get direction(): string {
    return this.#state.direction;
  }
  set direction(value: string) {
    const index = DIRECTIONS.indexOf(value as never);
    if (index < 0) return;
    this.#state.direction = DIRECTIONS[index];
    // `inherit` is the canvas's direction, which is left to right on Lynx.
    this.#cmd(OP.setDirection, index === 1 ? 1 : 0);
  }

  get letterSpacing(): string {
    return this.#state.letterSpacing;
  }
  set letterSpacing(value: string) {
    const match = /^\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)(px|em|rem|pt)\s*$/i.exec(
      String(value),
    );
    if (!match) return;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const pixels =
      unit === 'px'
        ? amount
        : unit === 'pt'
          ? (amount * 4) / 3
          : unit === 'rem'
            ? amount * 16
            : amount * this.#state.font.size;
    this.#state.letterSpacing = `${amount}${unit}`;
    this.#state.letterSpacingPixels = pixels;
    this.#cmd(OP.setLetterSpacing, pixels);
  }

  get wordSpacing(): string {
    return this.#state.wordSpacing;
  }
  set wordSpacing(value: string) {
    if (/^\s*-?\d*\.?\d+(px|em|rem|pt)\s*$/i.test(String(value))) {
      this.#state.wordSpacing = String(value).trim();
    }
  }

  get fontKerning(): string {
    return this.#state.fontKerning;
  }
  set fontKerning(value: string) {
    if (['auto', 'normal', 'none'].includes(value))
      this.#state.fontKerning = value;
  }

  get fontStretch(): string {
    return this.#state.fontStretch;
  }
  set fontStretch(value: string) {
    this.#state.fontStretch = String(value);
  }

  get fontVariantCaps(): string {
    return this.#state.fontVariantCaps;
  }
  set fontVariantCaps(value: string) {
    this.#state.fontVariantCaps = String(value);
  }

  get textRendering(): string {
    return this.#state.textRendering;
  }
  set textRendering(value: string) {
    this.#state.textRendering = String(value);
  }

  /**
   * --- Rectangles ----------------------------------------------------------
   */

  #rectSegments(x: number, y: number, w: number, h: number): number[] {
    const builder = new PathBuilder();
    builder.matrix = this.#state.transform;
    builder.rect(x, y, w, h);
    return builder.segments;
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    if (!finite(x, y, w, h) || w === 0 || h === 0) return;
    this.#draw(OP.clearPath, this.#rectSegments(x, y, w, h));
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (!finite(x, y, w, h) || w === 0 || h === 0) return;
    this.#draw(OP.fill, this.#rectSegments(x, y, w, h), 0);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    if (!finite(x, y, w, h) || (w === 0 && h === 0)) return;
    if (w === 0 || h === 0) {
      // A rectangle with no width or height strokes as a line.
      const builder = new PathBuilder();
      builder.matrix = this.#state.transform;
      builder.moveTo(x, y);
      builder.lineTo(x + w, y + h);
      this.#draw(OP.stroke, builder.segments);
      return;
    }
    this.#draw(OP.stroke, this.#rectSegments(x, y, w, h));
  }

  /**
   * --- The current path ----------------------------------------------------
   */

  beginPath(): void {
    this.#path.clear();
  }

  closePath(): void {
    this.#path.closePath();
  }

  moveTo(x: number, y: number): void {
    this.#path.moveTo(Number(x), Number(y));
  }

  lineTo(x: number, y: number): void {
    this.#path.lineTo(Number(x), Number(y));
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.#path.quadraticCurveTo(Number(cpx), Number(cpy), Number(x), Number(y));
  }

  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.#path.bezierCurveTo(
      Number(cp1x),
      Number(cp1y),
      Number(cp2x),
      Number(cp2y),
      Number(x),
      Number(y),
    );
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.#path.arcTo(
      Number(x1),
      Number(y1),
      Number(x2),
      Number(y2),
      Number(radius),
    );
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.#path.rect(Number(x), Number(y), Number(w), Number(h));
  }

  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii?: number | RadiusInit | Iterable<number | RadiusInit>,
  ): void {
    this.#path.roundRect(Number(x), Number(y), Number(w), Number(h), radii);
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.#path.arc(
      Number(x),
      Number(y),
      Number(radius),
      Number(startAngle),
      Number(endAngle),
      !!counterclockwise,
    );
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.#path.ellipse(
      Number(x),
      Number(y),
      Number(radiusX),
      Number(radiusY),
      Number(rotation),
      Number(startAngle),
      Number(endAngle),
      !!counterclockwise,
    );
  }

  /**
   * A Path2D's segments in the canvas's pixels, or the current path's.
   */
  #segmentsOf(path: LynxPath2D | undefined): number[] {
    return path
      ? transformSegments(path.builder.segments, this.#state.transform)
      : this.#path.segments.slice();
  }

  /**
   * fill(), clip() and isPointInPath()'s overloads: a Path2D first, or not.
   */
  #pathAndRule(
    pathOrRule: LynxPath2D | string | undefined,
    rule: string | undefined,
  ): [LynxPath2D | undefined, number] {
    const path = pathOrRule instanceof LynxPath2D ? pathOrRule : undefined;
    const name = path ? rule : (pathOrRule as string | undefined);
    if (name !== undefined && !FILL_RULES.includes(name)) {
      throw new TypeError(
        `The provided value '${name}' is not a valid enum value of type CanvasFillRule.`,
      );
    }
    return [path, name === 'evenodd' ? 1 : 0];
  }

  fill(pathOrRule?: LynxPath2D | string, rule?: string): void {
    const [path, fillRule] = this.#pathAndRule(pathOrRule, rule);
    const segments = this.#segmentsOf(path);
    if (segments.length === 0) return;
    this.#draw(OP.fill, segments, fillRule);
  }

  stroke(path?: LynxPath2D): void {
    const segments = this.#segmentsOf(
      path instanceof LynxPath2D ? path : undefined,
    );
    if (segments.length === 0) return;
    this.#draw(OP.stroke, segments);
  }

  clip(pathOrRule?: LynxPath2D | string, rule?: string): void {
    const [path, fillRule] = this.#pathAndRule(pathOrRule, rule);
    this.#cmd(OP.clip, this.#segmentsOf(path), fillRule);
  }

  isPointInPath(
    pathOrX: LynxPath2D | number,
    xOrY: number,
    yOrRule?: number | string,
    rule?: string,
  ): boolean {
    let path: LynxPath2D | undefined;
    let x: number;
    let y: number;
    let ruleName: string | undefined;
    if (pathOrX instanceof LynxPath2D) {
      path = pathOrX;
      x = Number(xOrY);
      y = Number(yOrRule);
      ruleName = rule;
    } else {
      x = Number(pathOrX);
      y = Number(xOrY);
      ruleName = yOrRule as string | undefined;
    }
    const [, fillRule] = this.#pathAndRule(ruleName, undefined);
    if (!finite(x, y)) return false;
    const segments = this.#segmentsOf(path);
    if (segments.length === 0) return false;
    return !!this.#query(OP.isPointInPath, segments, fillRule, x, y);
  }

  isPointInStroke(
    pathOrX: LynxPath2D | number,
    xOrY: number,
    y?: number,
  ): boolean {
    const path = pathOrX instanceof LynxPath2D ? pathOrX : undefined;
    const px = Number(path ? xOrY : pathOrX);
    const py = Number(path ? y : xOrY);
    if (!finite(px, py)) return false;
    const segments = this.#segmentsOf(path);
    if (segments.length === 0) return false;
    return !!this.#query(OP.isPointInStroke, segments, px, py);
  }

  drawFocusIfNeeded(): void {
    // Lynx has no focus ring to draw.
  }

  /**
   * --- Text ----------------------------------------------------------------
   */

  /**
   * The text as the spec draws it, with its spaces collapsed to plain ones,
   * and without NULs, at which a string ends on the bridge.
   */
  #text(text: unknown): string {
    return String(text)
      .replace(/[\t\n\f\r]/g, ' ')
      .split('\0')
      .join('');
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.#drawText(OP.fillText, text, x, y, maxWidth);
  }

  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    this.#drawText(OP.strokeText, text, x, y, maxWidth);
  }

  #drawText(
    op: number,
    text: string,
    x: number,
    y: number,
    maxWidth: number | undefined,
  ): void {
    const px = Number(x);
    const py = Number(y);
    if (!finite(px, py)) return;
    let limit = -1;
    if (maxWidth !== undefined) {
      limit = Number(maxWidth);
      if (!Number.isFinite(limit) || limit <= 0) return;
    }
    const value = this.#text(text);
    if (value === '') return;
    this.#draw(op, value, px, py, limit);
  }

  measureText(text: string): LynxTextMetrics {
    const values = this.#query(OP.measureText, this.#text(text));
    return new LynxTextMetrics(Array.isArray(values) ? values : []);
  }

  /**
   * --- Images --------------------------------------------------------------
   */

  /**
   * What the shell reads an image from, or null when there's nothing to draw
   * yet (an image still loading). Throws for what can't be drawn, as
   * browsers do.
   */
  #imageSource(image: unknown, method: string): ImageSource | null {
    const native = nativeImageOf(image);
    if (native) {
      if (native.id === 0) return null;
      return {
        descriptor: { image: native.id },
        width: native.width,
        height: native.height,
      };
    }
    const canvas = canvasSourceOf(image);
    if (canvas) {
      // A video before its first frame is HAVE_NOTHING: browsers draw
      // nothing from it, and createPattern() returns null.
      if (canvas.video && (canvas.width === 0 || canvas.height === 0)) {
        return null;
      }
      if (canvas.width === 0 || canvas.height === 0) {
        throw domError(
          'InvalidStateError',
          `Failed to execute '${method}' on 'CanvasRenderingContext2D': The image argument is a canvas element with a width or height of 0.`,
        );
      }
      // A canvas without a context is a transparent image of its size,
      // which still clears what an operation like destination-in leaves.
      if (!canvas.readable) {
        return {
          descriptor: {
            blank: true,
            width: canvas.width,
            height: canvas.height,
          },
          width: canvas.width,
          height: canvas.height,
        };
      }
      return {
        descriptor: { canvas: canvas.canvasId },
        width: canvas.width,
        height: canvas.height,
        flush: () => canvas.flush(),
      };
    }
    throw new TypeError(
      `Failed to execute '${method}' on 'CanvasRenderingContext2D': The provided value is not of type '(HTMLCanvasElement or HTMLImageElement or ImageBitmap or OffscreenCanvas)'.`,
    );
  }

  drawImage(image: unknown, ...args: number[]): void {
    if (args.length !== 2 && args.length !== 4 && args.length !== 8) {
      throw new TypeError(
        `Failed to execute 'drawImage' on 'CanvasRenderingContext2D': Valid arities are: [3, 5, 9], but ${args.length + 1} arguments provided.`,
      );
    }
    const source = this.#imageSource(image, 'drawImage');
    if (!source) return;
    const numbers = args.map(Number);
    if (!finite(...numbers)) return;
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (numbers.length === 2) {
      [dx, dy] = numbers;
      dw = sw;
      dh = sh;
    } else if (numbers.length === 4) {
      [dx, dy, dw, dh] = numbers;
    } else {
      [sx, sy, sw, sh, dx, dy, dw, dh] = numbers;
    }
    if (sw === 0 || sh === 0 || dw === 0 || dh === 0) return;
    // Negative sizes go the other way from the corner, as the spec has it.
    if (sw < 0) {
      sx += sw;
      sw = -sw;
    }
    if (sh < 0) {
      sy += sh;
      sh = -sh;
    }
    if (dw < 0) {
      dx += dw;
      dw = -dw;
    }
    if (dh < 0) {
      dy += dh;
      dh = -dh;
    }
    // The part of the source outside the image is cut, and the destination
    // with it.
    const scaleX = dw / sw;
    const scaleY = dh / sh;
    if (sx < 0) {
      dx -= sx * scaleX;
      dw += sx * scaleX;
      sw += sx;
      sx = 0;
    }
    if (sy < 0) {
      dy -= sy * scaleY;
      dh += sy * scaleY;
      sh += sy;
      sy = 0;
    }
    if (sx + sw > source.width) {
      const cut = sx + sw - source.width;
      dw -= cut * scaleX;
      sw -= cut;
    }
    if (sy + sh > source.height) {
      const cut = sy + sh - source.height;
      dh -= cut * scaleY;
      sh -= cut;
    }
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    source.flush?.();
    this.#draw(OP.drawImage, source.descriptor, sx, sy, sw, sh, dx, dy, dw, dh);
    // Another canvas is drawn as it is now, before it draws more.
    if (source.flush) this.#send();
  }

  /**
   * --- Pixels --------------------------------------------------------------
   */

  createImageData(
    widthOrImageData: number | LynxImageData,
    height?: number,
  ): LynxImageData {
    if (widthOrImageData instanceof LynxImageData) {
      return new LynxImageData(widthOrImageData.width, widthOrImageData.height);
    }
    return new LynxImageData(
      Math.abs(enforceLong(widthOrImageData, 'createImageData')),
      Math.abs(enforceLong(height, 'createImageData')),
    );
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): LynxImageData {
    let x = enforceLong(sx, 'getImageData');
    let y = enforceLong(sy, 'getImageData');
    let w = enforceLong(sw, 'getImageData');
    let h = enforceLong(sh, 'getImageData');
    if (w === 0 || h === 0) {
      throw domError(
        'IndexSizeError',
        `Failed to execute 'getImageData' on 'CanvasRenderingContext2D': The source ${w === 0 ? 'width' : 'height'} is 0.`,
      );
    }
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    const bytes = fromWords(this.#query(OP.getImageData, x, y, w, h));
    const data = new Uint8ClampedArray(w * h * 4);
    data.set(bytes.subarray(0, data.length));
    return new LynxImageData(data, w, h);
  }

  putImageData(
    imageData: LynxImageData,
    dx: number,
    dy: number,
    ...dirty: [number?, number?, number?, number?]
  ): void {
    // The overload is chosen by how many arguments there are, so an
    // undefined dirty rectangle is an error, not the whole image.
    const [dirtyX, dirtyY, dirtyWidth, dirtyHeight] = dirty;
    if (!imageData || !(imageData.data instanceof Uint8ClampedArray)) {
      throw new TypeError(
        "Failed to execute 'putImageData' on 'CanvasRenderingContext2D': parameter 1 is not of type 'ImageData'.",
      );
    }
    const x0 = enforceLong(dx, 'putImageData');
    const y0 = enforceLong(dy, 'putImageData');
    let rx = 0;
    let ry = 0;
    let rw = imageData.width;
    let rh = imageData.height;
    if (dirty.length > 0) {
      rx = enforceLong(dirtyX, 'putImageData');
      ry = enforceLong(dirtyY, 'putImageData');
      rw = enforceLong(dirtyWidth, 'putImageData');
      rh = enforceLong(dirtyHeight, 'putImageData');
      if (rw < 0) {
        rx += rw;
        rw = -rw;
      }
      if (rh < 0) {
        ry += rh;
        rh = -rh;
      }
      if (rx < 0) {
        rw += rx;
        rx = 0;
      }
      if (ry < 0) {
        rh += ry;
        ry = 0;
      }
      rw = Math.min(rw, imageData.width - rx);
      rh = Math.min(rh, imageData.height - ry);
    }
    if (rw <= 0 || rh <= 0) return;
    // The rectangle's rows, packed: the shell writes them as they are,
    // whatever the transform, clip and compositing.
    const rows = new Uint8Array(rw * rh * 4);
    const stride = imageData.width * 4;
    for (let row = 0; row < rh; row++) {
      const start = (ry + row) * stride + rx * 4;
      rows.set(imageData.data.subarray(start, start + rw * 4), row * rw * 4);
    }
    this.#draw(OP.putImageData, toWords(rows), rw, rh, x0 + rx, y0 + ry);
  }
}
