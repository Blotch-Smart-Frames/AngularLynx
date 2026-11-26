// cspell:words arities
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toWords } from '../network/words';
import {
  createFakeCanvas2DBridge,
  type FakeCanvas2DBridge,
} from '../testing/fake-canvas-2d-bridge';
import {
  canvas2DAttributesFrom,
  LynxCanvasGradient,
  LynxCanvasPattern,
  LynxCanvasRenderingContext2D,
  LynxDOMMatrix,
  LynxImageData,
  LynxTextMetrics,
} from './canvas-2d-context';
import { OP, PATH_OP } from './canvas-2d-ops';
import { CANVAS_SOURCE, type CanvasSource } from './canvas-source';
import { NATIVE_IMAGE } from './native-image';
import { LynxPath2D } from './path';

const { moveTo: M, lineTo: L, close: Z } = PATH_OP;

let bridge: FakeCanvas2DBridge;
const canvas = { width: 300, height: 150 };

const make = (attributes = canvas2DAttributesFrom(undefined), contextId = 7) =>
  new LynxCanvasRenderingContext2D(bridge, contextId, canvas, attributes);

/**
 * The commands sent so far, after the end of the task.
 */
const sent = async (): Promise<unknown[]> => {
  await Promise.resolve();
  return bridge.sent();
};

const image = (id: number, width = 4, height = 2) => ({
  [NATIVE_IMAGE]: { id, width, height, bakedOptions: false },
});

const canvasSource = (overrides: Partial<CanvasSource> = {}) => {
  const flush = vi.fn();
  return {
    flush,
    [CANVAS_SOURCE]: {
      canvasId: 'other',
      width: 10,
      height: 10,
      readable: true,
      flush,
      ...overrides,
    },
  };
};

beforeEach(() => {
  bridge = createFakeCanvas2DBridge();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LynxCanvasRenderingContext2D', () => {
  it('sends a task’s calls in one batch, and shows the bitmap after one that drew', async () => {
    const context = make();
    expect(context.canvas).toBe(canvas);
    context.fillStyle = 'red';
    context.fillRect(0, 0, 10, 10);
    expect(bridge.batches).toEqual([]);
    expect(await sent()).toEqual([
      OP.setFillColor,
      255,
      0,
      0,
      1,
      OP.fill,
      [M, 0, 0, L, 10, 0, L, 10, 10, L, 0, 10, Z, M, 0, 0],
      0,
      OP.present,
    ]);
    // A task that only set state shows nothing new.
    context.lineWidth = 2;
    await Promise.resolve();
    expect(bridge.batches[1]).toEqual([OP.setLineWidth, 2]);
  });

  it('sends a long batch before it grows more', () => {
    const context = make();
    for (let i = 0; i < 40000; i++) context.globalAlpha = 0.5;
    expect(bridge.batches.length).toBe(1);
    expect(bridge.batches[0].length).toBeGreaterThan(65536);
  });

  it('answers its attributes, and is never lost', () => {
    const context = make(
      canvas2DAttributesFrom({ alpha: false, willReadFrequently: true }),
    );
    expect(context.getContextAttributes()).toEqual({
      alpha: false,
      colorSpace: 'srgb',
      desynchronized: false,
      willReadFrequently: true,
    });
    expect(context.isContextLost()).toBe(false);
  });

  it('keeps its state as browsers serialize it, and ignores values that aren’t valid', async () => {
    const context = make();
    expect(context.fillStyle).toBe('#000000');
    context.fillStyle = 'rgba(255, 0, 0, 0.5)';
    context.fillStyle = 'nope';
    expect(context.fillStyle).toBe('rgba(255, 0, 0, 0.5)');
    context.strokeStyle = 'hsl(120 100% 50%)';
    context.strokeStyle = 'nope';
    expect(context.strokeStyle).toBe('#00ff00');
    context.globalAlpha = 0.5;
    context.globalAlpha = 2;
    context.globalAlpha = NaN;
    expect(context.globalAlpha).toBe(0.5);
    context.globalCompositeOperation = 'multiply';
    context.globalCompositeOperation = 'nope';
    expect(context.globalCompositeOperation).toBe('multiply');
    context.lineWidth = 0;
    context.lineWidth = -1;
    expect(context.lineWidth).toBe(1);
    context.lineCap = 'round';
    context.lineCap = 'nope';
    expect(context.lineCap).toBe('round');
    context.lineJoin = 'bevel';
    context.lineJoin = 'nope';
    expect(context.lineJoin).toBe('bevel');
    context.miterLimit = 4;
    context.miterLimit = 0;
    expect(context.miterLimit).toBe(4);
    context.shadowBlur = 3;
    context.shadowBlur = -1;
    expect(context.shadowBlur).toBe(3);
    context.shadowColor = 'blue';
    context.shadowColor = 'nope';
    expect(context.shadowColor).toBe('#0000ff');
    context.shadowOffsetX = 2;
    context.shadowOffsetX = Infinity;
    context.shadowOffsetY = -2;
    context.shadowOffsetY = NaN;
    expect([context.shadowOffsetX, context.shadowOffsetY]).toEqual([2, -2]);
    context.textAlign = 'center';
    context.textAlign = 'nope';
    expect(context.textAlign).toBe('center');
    context.textBaseline = 'middle';
    context.textBaseline = 'nope';
    expect(context.textBaseline).toBe('middle');
    context.direction = 'rtl';
    context.direction = 'nope';
    expect(context.direction).toBe('rtl');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingEnabled = false;
    context.imageSmoothingQuality = 'high';
    context.imageSmoothingQuality = 'nope';
    expect([
      context.imageSmoothingEnabled,
      context.imageSmoothingQuality,
    ]).toEqual([false, 'high']);
    context.filter = 'blur(2px)';
    expect(context.filter).toBe('blur(2px)');
    context.wordSpacing = '2px';
    context.wordSpacing = 'nope';
    expect(context.wordSpacing).toBe('2px');
    context.fontKerning = 'none';
    context.fontKerning = 'nope';
    expect(context.fontKerning).toBe('none');
    context.fontStretch = 'condensed';
    context.fontVariantCaps = 'small-caps';
    context.textRendering = 'geometricPrecision';
    expect([
      context.fontStretch,
      context.fontVariantCaps,
      context.textRendering,
    ]).toEqual(['condensed', 'small-caps', 'geometricPrecision']);
    expect(await sent()).toEqual([
      OP.setFillColor,
      255,
      0,
      0,
      0.5,
      OP.setStrokeColor,
      0,
      255,
      0,
      1,
      OP.setGlobalAlpha,
      0.5,
      OP.setCompositeOperation,
      11,
      OP.setLineCap,
      1,
      OP.setLineJoin,
      2,
      OP.setMiterLimit,
      4,
      OP.setShadow,
      3,
      0,
      0,
      0,
      0,
      0,
      0,
      OP.setShadow,
      3,
      0,
      0,
      255,
      1,
      0,
      0,
      OP.setShadow,
      3,
      0,
      0,
      255,
      1,
      2,
      0,
      OP.setShadow,
      3,
      0,
      0,
      255,
      1,
      2,
      -2,
      OP.setTextAlign,
      4,
      OP.setTextBaseline,
      2,
      OP.setDirection,
      1,
      OP.setImageSmoothing,
      1,
      0,
      OP.setImageSmoothing,
      0,
      0,
      OP.setImageSmoothing,
      0,
      2,
    ]);
  });

  it('sends the font’s parts, and an inherited direction as left to right', async () => {
    const context = make();
    expect(context.font).toBe('10px sans-serif');
    context.font = 'italic bold 20px "My Font", serif';
    context.font = 'nope';
    expect(context.font).toBe('italic bold 20px "My Font", serif');
    context.direction = 'inherit';
    expect(await sent()).toEqual([
      OP.setFont,
      1,
      700,
      20,
      'My Font\nserif',
      OP.setDirection,
      0,
    ]);
  });

  it('turns letter spacing into pixels, following the font for em', async () => {
    const context = make();
    expect(context.letterSpacing).toBe('0px');
    context.letterSpacing = '2px';
    context.letterSpacing = '3pt';
    context.letterSpacing = '1rem';
    context.letterSpacing = 'nope';
    context.letterSpacing = '0.5em';
    expect(context.letterSpacing).toBe('0.5em');
    context.font = '20px serif';
    expect(await sent()).toEqual([
      OP.setLetterSpacing,
      2,
      OP.setLetterSpacing,
      4,
      OP.setLetterSpacing,
      16,
      OP.setLetterSpacing,
      5,
      OP.setFont,
      0,
      400,
      20,
      'serif',
      OP.setLetterSpacing,
      10,
    ]);
  });

  it('dashes lines, repeating an odd list, and draws a list of zeros solid', async () => {
    const context = make();
    context.setLineDash([1, 2, 3]);
    expect(context.getLineDash()).toEqual([1, 2, 3, 1, 2, 3]);
    context.setLineDash([1, -1]);
    context.setLineDash([NaN]);
    context.lineDashOffset = 4;
    context.lineDashOffset = NaN;
    expect(context.lineDashOffset).toBe(4);
    context.setLineDash([0, 0]);
    context.setLineDash(undefined as never);
    expect(await sent()).toEqual([
      OP.setLineDash,
      [1, 2, 3, 1, 2, 3],
      0,
      OP.setLineDash,
      [1, 2, 3, 1, 2, 3],
      4,
      OP.setLineDash,
      [],
      4,
      OP.setLineDash,
      [],
      4,
    ]);
  });

  it('saves and restores its state, and the shell’s with it', async () => {
    const context = make();
    context.restore();
    context.fillStyle = 'red';
    context.setLineDash([1, 1]);
    context.save();
    context.fillStyle = 'blue';
    context.translate(5, 5);
    context.setLineDash([2, 2]);
    context.restore();
    expect(context.fillStyle).toBe('#ff0000');
    expect(context.getLineDash()).toEqual([1, 1]);
    expect(context.getTransform()).toMatchObject({ e: 0, f: 0 });
    // The path's points use the restored transform.
    context.moveTo(1, 1);
    context.lineTo(2, 2);
    context.stroke();
    expect(await sent()).toEqual([
      OP.setFillColor,
      255,
      0,
      0,
      1,
      OP.setLineDash,
      [1, 1],
      0,
      OP.save,
      OP.setFillColor,
      0,
      0,
      255,
      1,
      OP.setTransform,
      1,
      0,
      0,
      1,
      5,
      5,
      OP.setLineDash,
      [2, 2],
      0,
      OP.restore,
      OP.stroke,
      [M, 1, 1, L, 2, 2],
      OP.present,
    ]);
  });

  it('resets its state, its path and the bitmap', async () => {
    const context = make();
    context.fillStyle = 'red';
    context.translate(4, 4);
    context.save();
    context.moveTo(0, 0);
    context.reset();
    expect(context.fillStyle).toBe('#000000');
    expect(context.getTransform()).toMatchObject({ e: 0 });
    context.restore();
    context.stroke();
    context.resize(20, 10);
    expect(await sent()).toEqual([
      OP.setFillColor,
      255,
      0,
      0,
      1,
      OP.setTransform,
      1,
      0,
      0,
      1,
      4,
      4,
      OP.save,
      OP.reset,
      OP.resize,
      20,
      10,
      OP.present,
    ]);
  });

  it('transforms, as the spec has it', async () => {
    const context = make();
    context.translate(5, 20);
    context.scale(2, 3);
    context.rotate(Math.PI / 2);
    context.transform(1, 0, 0, 1, 1, 1);
    const matrix = context.getTransform() as LynxDOMMatrix;
    expect(matrix).toBeInstanceOf(LynxDOMMatrix);
    expect(
      [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map((n) =>
        Math.round(n),
      ),
    ).toEqual([0, 3, -2, 0, 3, 23]);
    context.translate(NaN, 0);
    context.scale(Infinity, 1);
    context.rotate(NaN);
    context.transform(NaN, 0, 0, 1, 0, 0);
    context.setTransform(1, 0, 0, 1, NaN, 0);
    context.setTransform(2, 0, 0, 2, 0, 0);
    context.setTransform({ a: 3, d: 3 });
    context.setTransform();
    context.resetTransform();
    // Each change sends the whole matrix: eight of them.
    expect((await sent()).length).toBe(8 * 7);
  });

  it('returns the browser’s DOMMatrix where there is one', () => {
    class DOMMatrix {
      constructor(readonly init: number[]) {}
    }
    vi.stubGlobal('DOMMatrix', DOMMatrix);
    expect(make().getTransform()).toEqual(new DOMMatrix([1, 0, 0, 1, 0, 0]));
  });

  it('builds the path in the canvas’s pixels, transformed as each point is added', async () => {
    const context = make();
    context.beginPath();
    context.moveTo(1, 1);
    context.scale(2, 2);
    context.lineTo(1, 1);
    context.quadraticCurveTo(1, 2, 2, 2);
    context.bezierCurveTo(1, 2, 3, 4, 5, 6);
    context.arcTo(5, 8, 7, 8, 1);
    context.rect(0, 0, 1, 1);
    context.roundRect(0, 0, 4, 4, 1);
    context.arc(0, 0, 1, 0, 1);
    context.ellipse(0, 0, 1, 2, 0, 0, 1, true);
    context.closePath();
    context.fill();
    const commands = await sent();
    const path = commands[commands.indexOf(OP.fill) + 1] as number[];
    expect(path.slice(0, 6)).toEqual([M, 1, 1, L, 2, 2]);
    expect(path.at(-1)).toBe(Z);
  });

  it('fills, strokes and clips the path or a Path2D, with a fill rule', async () => {
    const context = make();
    const triangle = new LynxPath2D('M0 0 L 4 0 L 0 4 Z');
    context.translate(1, 0);
    context.fill(triangle, 'evenodd');
    context.stroke(triangle);
    context.clip(triangle);
    context.rect(0, 0, 1, 1);
    context.fill('nonzero');
    context.clip('evenodd');
    expect(() => context.fill('sideways')).toThrow(/CanvasFillRule/);
    // An empty path draws nothing, but clips everything.
    context.beginPath();
    context.fill();
    context.stroke();
    context.clip();
    const moved = [M, 1, 0, L, 5, 0, L, 1, 4, Z];
    const square = [M, 1, 0, L, 2, 0, L, 2, 1, L, 1, 1, Z, M, 1, 0];
    expect(await sent()).toEqual([
      OP.setTransform,
      1,
      0,
      0,
      1,
      1,
      0,
      OP.fill,
      moved,
      1,
      OP.stroke,
      moved,
      OP.clip,
      moved,
      0,
      OP.fill,
      square,
      0,
      OP.clip,
      square,
      1,
      OP.clip,
      [],
      0,
      OP.present,
    ]);
  });

  it('draws rectangles without touching the path', async () => {
    const context = make();
    context.moveTo(5, 5);
    context.clearRect(0, 0, 2, 2);
    context.fillRect(0, 0, 2, 2);
    context.strokeRect(0, 0, 2, 2);
    // A strokeRect with no width or height is a line.
    context.strokeRect(0, 0, 2, 0);
    // Nothing for these.
    context.clearRect(0, 0, 0, 2);
    context.fillRect(NaN, 0, 2, 2);
    context.strokeRect(0, 0, 0, 0);
    context.strokeRect(0, NaN, 1, 1);
    const square = [M, 0, 0, L, 2, 0, L, 2, 2, L, 0, 2, Z, M, 0, 0];
    expect(await sent()).toEqual([
      OP.clearPath,
      square,
      OP.fill,
      square,
      0,
      OP.stroke,
      square,
      OP.stroke,
      [M, 0, 0, L, 2, 0],
      OP.present,
    ]);
  });

  it('asks the shell whether a point is in the path or its stroke', async () => {
    const context = make();
    context.rect(0, 0, 10, 10);
    bridge.answers = [true];
    expect(context.isPointInPath(5, 5)).toBe(true);
    expect(bridge.batches.at(-1)).toEqual([
      OP.isPointInPath,
      [M, 0, 0, L, 10, 0, L, 10, 10, L, 0, 10, Z, M, 0, 0],
      0,
      5,
      5,
    ]);
    const path = new LynxPath2D('M0 0 L1 1');
    bridge.answers = [true];
    expect(context.isPointInPath(path, 1, 2, 'evenodd')).toBe(true);
    expect(bridge.batches.at(-1)).toEqual([
      OP.isPointInPath,
      [M, 0, 0, L, 1, 1],
      1,
      1,
      2,
    ]);
    expect(context.isPointInPath(NaN, 1)).toBe(false);
    expect(context.isPointInPath(new LynxPath2D(), 1, 1)).toBe(false);
    bridge.answers = [true];
    expect(context.isPointInStroke(3, 4)).toBe(true);
    bridge.answers = [false];
    expect(context.isPointInStroke(path, 3, 4)).toBe(false);
    expect(bridge.batches.at(-1)).toEqual([
      OP.isPointInStroke,
      [M, 0, 0, L, 1, 1],
      3,
      4,
    ]);
    expect(context.isPointInStroke(NaN, 4)).toBe(false);
    expect(context.isPointInStroke(new LynxPath2D(), 1, 1)).toBe(false);
    // An answer the shell didn't give is no.
    expect(context.isPointInStroke(1, 1)).toBe(false);
    expect(() => context.isPointInPath(1, 1, 'nope')).toThrow(TypeError);
    context.drawFocusIfNeeded();
  });

  it('draws and measures text, with the spec’s whitespace and maxWidth', async () => {
    const context = make();
    context.fillText('a\tb\n\u0000c', 1, 2);
    context.strokeText('d', 3, 4, 50);
    // Nothing for these.
    context.fillText('e', NaN, 0);
    context.fillText('f', 0, 0, 0);
    context.fillText('g', 0, 0, NaN);
    context.fillText('', 0, 0);
    expect(await sent()).toEqual([
      OP.fillText,
      'a b c',
      1,
      2,
      -1,
      OP.strokeText,
      'd',
      3,
      4,
      50,
      OP.present,
    ]);
    bridge.answers = [[10, 1, 9, 8, 2, 7, 1, 8, 2, 6, 0, -2]];
    const metrics = context.measureText('hi');
    expect(metrics).toBeInstanceOf(LynxTextMetrics);
    expect(metrics).toMatchObject({
      width: 10,
      actualBoundingBoxLeft: 1,
      actualBoundingBoxRight: 9,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
      actualBoundingBoxAscent: 7,
      actualBoundingBoxDescent: 1,
      emHeightAscent: 8,
      emHeightDescent: 2,
      hangingBaseline: 6,
      alphabeticBaseline: 0,
      ideographicBaseline: -2,
    });
    expect(bridge.batches.at(-1)).toEqual([OP.measureText, 'hi']);
    // No answer measures nothing.
    expect(context.measureText('x').width).toBe(0);
    expect(new LynxTextMetrics([1]).ideographicBaseline).toBe(0);
  });

  it('makes gradients the shell keeps, and frees them when they’re collected', async () => {
    let free: (() => void) | undefined;
    vi.stubGlobal(
      'FinalizationRegistry',
      class {
        constructor(readonly callback: (held: () => void) => void) {}
        register(_target: object, held: () => void) {
          free = () => this.callback(held);
        }
      },
    );
    vi.resetModules();
    const module = await import('./canvas-2d-context');
    const context = new module.LynxCanvasRenderingContext2D(
      bridge,
      7,
      canvas,
      module.canvas2DAttributesFrom(undefined),
    );
    const linear = context.createLinearGradient(0, 0, 10, 0);
    linear.addColorStop(0, 'red');
    linear.addColorStop(1, 'rgba(0, 0, 255, 0.5)');
    context.fillStyle = linear;
    expect(context.fillStyle).toBe(linear);
    const radial = context.createRadialGradient(0, 0, 1, 0, 0, 5);
    const conic = context.createConicGradient(1, 2, 3);
    context.strokeStyle = conic;
    expect(context.strokeStyle).toBe(conic);
    free!();
    expect(await sent()).toEqual([
      OP.createLinearGradient,
      1,
      0,
      0,
      10,
      0,
      OP.addColorStop,
      1,
      0,
      255,
      0,
      0,
      1,
      OP.addColorStop,
      1,
      1,
      0,
      0,
      255,
      0.5,
      OP.setFillGradient,
      1,
      OP.createRadialGradient,
      2,
      0,
      0,
      1,
      0,
      0,
      5,
      OP.createConicGradient,
      3,
      1,
      2,
      3,
      OP.setStrokeGradient,
      3,
    ]);
    // Freed through the module, which every context's objects share, so it
    // goes whether or not the context that made it is still there.
    expect(bridge.release2D).toHaveBeenCalledWith(3);
    // Even after the context that made it is gone.
    context.destroy();
    bridge.release2D.mockClear();
    free!();
    expect(bridge.release2D).toHaveBeenCalledWith(3);
    expect(radial).toBeInstanceOf(module.LynxCanvasGradient);
  });

  it('refuses what a gradient can’t take, and another context’s gradient', () => {
    const context = make();
    expect(() => context.createLinearGradient(0, 0, NaN, 0)).toThrow(TypeError);
    expect(() => context.createRadialGradient(0, 0, 1, 0, 0, Infinity)).toThrow(
      TypeError,
    );
    expect(() => context.createRadialGradient(0, 0, -1, 0, 0, 1)).toThrow(
      /r0 provided/,
    );
    expect(() => context.createRadialGradient(0, 0, 1, 0, 0, -1)).toThrow(
      /r1 provided/,
    );
    expect(() => context.createConicGradient(NaN, 0, 0)).toThrow(TypeError);
    const gradient = context.createLinearGradient(0, 0, 1, 1);
    expect(() => gradient.addColorStop(NaN, 'red')).toThrow(TypeError);
    expect(() => gradient.addColorStop(1.5, 'red')).toThrow(
      expect.objectContaining({ name: 'IndexSizeError' }),
    );
    expect(() => gradient.addColorStop(0.5, 'nope')).toThrow(
      expect.objectContaining({ name: 'SyntaxError' }),
    );
    expect(gradient).toBeInstanceOf(LynxCanvasGradient);
  });

  it('paints with another context’s gradients and patterns, made in the shell first', () => {
    const context = make(undefined, 7);
    const gradient = context.createLinearGradient(0, 0, 1, 1);
    const pattern = context.createPattern(image(3), null)!;
    const other = make(undefined, 8);
    other.fillStyle = gradient;
    expect(other.fillStyle).toBe(gradient);
    // The context that made them sent their calls before the other used them.
    expect(bridge.batches[0]).toEqual([
      OP.createLinearGradient,
      gradient.id,
      0,
      0,
      1,
      1,
      OP.createPattern,
      pattern.id,
      { image: 3 },
      0,
    ]);
    other.strokeStyle = pattern;
    expect(other.strokeStyle).toBe(pattern);
    // A change to one after it was set goes between the other's draws: its
    // earlier draw first, then the change, then its next draw.
    other.fillRect(0, 0, 1, 1);
    const before = bridge.batches.length;
    pattern.setTransform({ e: 4 });
    other.fillRect(1, 1, 1, 1);
    other.flush();
    const sent = bridge.batches.slice(before);
    expect(bridge.batchContexts.slice(before)).toEqual([8, 7, 8]);
    expect(sent[0]).toContain(OP.fill);
    expect(sent[1].slice(0, 2)).toEqual([OP.setPatternTransform, pattern.id]);
    expect(sent[2]).toContain(OP.fill);
    // Its own needn't be sent first.
    other.fillStyle = other.createLinearGradient(0, 0, 1, 1);
    other.strokeStyle = other.createPattern(image(3), null)!;
    const count = bridge.batches.length;
    other.fillRect(0, 0, 1, 1);
    expect(bridge.batches.length).toBe(count);
  });

  it('makes patterns of images and canvases, with a transform', async () => {
    const context = make();
    const pattern = context.createPattern(image(3), 'repeat-x')!;
    expect(pattern).toBeInstanceOf(LynxCanvasPattern);
    context.fillStyle = pattern;
    expect(context.fillStyle).toBe(pattern);
    context.strokeStyle = pattern;
    expect(context.strokeStyle).toBe(pattern);
    pattern.setTransform({ e: 2 });
    pattern.setTransform({ a: NaN });
    expect(context.createPattern(image(3), '')).not.toBeNull();
    // An image that hasn't loaded has no pattern yet.
    expect(context.createPattern(image(0), 'repeat')).toBeNull();
    expect(() => context.createPattern(image(3), 'sideways')).toThrow(
      expect.objectContaining({ name: 'SyntaxError' }),
    );
    const id = pattern.id;
    expect(await sent()).toEqual([
      OP.createPattern,
      id,
      { image: 3 },
      1,
      OP.setFillPattern,
      id,
      OP.setStrokePattern,
      id,
      OP.setPatternTransform,
      id,
      1,
      0,
      0,
      1,
      2,
      0,
      OP.createPattern,
      id + 1,
      { image: 3 },
      0,
    ]);
    // A canvas's pattern is of it as it is now: its calls go first, and the
    // pattern's at once.
    const other = canvasSource();
    context.createPattern(other, 'no-repeat');
    expect(other.flush).toHaveBeenCalled();
    expect(bridge.batches.at(-1)).toEqual([
      OP.createPattern,
      id + 2,
      { canvas: 'other' },
      3,
    ]);
  });

  it('draws images, cut to the image and its size, as the spec has it', async () => {
    const context = make();
    const picture = image(9, 4, 2);
    context.drawImage(picture, 1, 2);
    context.drawImage(picture, 1, 2, 8, 4);
    // A source that reaches outside the image is cut, the destination with it.
    context.drawImage(picture, -1, -1, 6, 4, 0, 0, 12, 8);
    // Negative sizes go the other way from the corner.
    context.drawImage(picture, 4, 2, -4, -2, 8, 4, -8, -4);
    // Nothing for these.
    context.drawImage(picture, 0, 0, 0, 2);
    context.drawImage(picture, NaN, 0);
    context.drawImage(picture, 5, 0, 1, 1, 0, 0, 1, 1);
    context.drawImage(image(0), 0, 0);
    expect(await sent()).toEqual([
      OP.drawImage,
      { image: 9 },
      0,
      0,
      4,
      2,
      1,
      2,
      4,
      2,
      OP.drawImage,
      { image: 9 },
      0,
      0,
      4,
      2,
      1,
      2,
      8,
      4,
      OP.drawImage,
      { image: 9 },
      0,
      0,
      4,
      2,
      2,
      2,
      8,
      4,
      OP.drawImage,
      { image: 9 },
      0,
      0,
      4,
      2,
      0,
      0,
      8,
      4,
      OP.present,
    ]);
    expect(() => context.drawImage(picture)).toThrow(/Valid arities/);
  });

  it('draws a canvas as it is when it’s drawn', () => {
    const context = make();
    const other = canvasSource();
    context.drawImage(other, 0, 0);
    expect(other.flush).toHaveBeenCalled();
    expect(bridge.batches.at(-1)).toEqual([
      OP.drawImage,
      { canvas: 'other' },
      0,
      0,
      10,
      10,
      0,
      0,
      10,
      10,
    ]);
    // A canvas without a context is a transparent image of its size, which
    // has nothing to send first.
    const blank = canvasSource({ readable: false });
    context.drawImage(blank, 0, 0);
    expect(blank.flush).not.toHaveBeenCalled();
    context.flush();
    expect(bridge.batches.at(-1)).toEqual([
      OP.drawImage,
      { blank: true, width: 10, height: 10 },
      0,
      0,
      10,
      10,
      0,
      0,
      10,
      10,
    ]);
    expect(() => context.drawImage(canvasSource({ width: 0 }), 0, 0)).toThrow(
      expect.objectContaining({ name: 'InvalidStateError' }),
    );
  });

  it('says a video can’t be drawn yet, and refuses what isn’t an image', () => {
    const context = make();
    expect(() => context.drawImage({ tagName: 'video' }, 0, 0)).toThrow(
      /<video>/,
    );
    expect(() => context.drawImage({}, 0, 0)).toThrow(/is not of type/);
    expect(() => context.createPattern(null, 'repeat')).toThrow(
      /is not of type/,
    );
  });

  it('reads pixels back as ImageData', () => {
    const context = make();
    context.fillRect(0, 0, 1, 1);
    bridge.answers = [toWords(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))];
    const data = context.getImageData(3, 4, -2, 1);
    expect(data).toBeInstanceOf(LynxImageData);
    expect([data.width, data.height]).toEqual([2, 1]);
    expect(Array.from(data.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bridge.batches.at(-1)!.slice(-5)).toEqual([
      OP.getImageData,
      1,
      4,
      2,
      1,
    ]);
    bridge.answers = [toWords(new Uint8Array(4))];
    context.getImageData(0, 3, 1, -1);
    expect(bridge.batches.at(-1)).toEqual([OP.getImageData, 0, 2, 1, 1]);
    expect(() => context.getImageData(0, 0, 0, 1)).toThrow(/source width is 0/);
    expect(() => context.getImageData(0, 0, 1, 0)).toThrow(
      /source height is 0/,
    );
    expect(() => context.getImageData(NaN, 0, 1, 1)).toThrow(TypeError);
    // A fraction is cut toward zero.
    bridge.answers = [toWords(new Uint8Array(4))];
    context.getImageData(-0.5, 0, 1, 1);
    expect(bridge.batches.at(-1)).toEqual([OP.getImageData, 0, 0, 1, 1]);
  });

  it('writes ImageData as it is, cut to its dirty rectangle', async () => {
    const context = make();
    const data = new LynxImageData(2, 2);
    data.data.set([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
    context.putImageData(data, 10, 20);
    context.putImageData(data, 10, 20, 1, 1, 5, 5);
    context.putImageData(data, 10, 20, 2, 2, -2, -1);
    context.putImageData(data, 0, 0, -1, -1, 2, 2);
    // Nothing for this.
    context.putImageData(data, 0, 0, 0, 0, 0, 0);
    // Its arguments are Web IDL longs: not finite is an error, not nothing,
    // and a fraction is cut toward zero.
    expect(() => context.putImageData(data, NaN, 0)).toThrow(TypeError);
    expect(() => context.putImageData(data, 0, 0, NaN, 0, 1, 1)).toThrow(
      TypeError,
    );
    expect(() => context.putImageData(data, 2 ** 31, 0)).toThrow(/'long'/);
    // An undefined dirty rectangle is the seven-argument form's error, not
    // the whole image.
    expect(() => context.putImageData(data, 0, 0, undefined, 0, 1, 1)).toThrow(
      TypeError,
    );
    expect(await sent()).toEqual([
      OP.putImageData,
      toWords(new Uint8Array(data.data)),
      2,
      2,
      10,
      20,
      OP.putImageData,
      toWords(new Uint8Array([4, 4, 4, 4])),
      1,
      1,
      11,
      21,
      OP.putImageData,
      toWords(new Uint8Array([3, 3, 3, 3, 4, 4, 4, 4])),
      2,
      1,
      10,
      21,
      OP.putImageData,
      toWords(new Uint8Array([1, 1, 1, 1])),
      1,
      1,
      0,
      0,
      OP.present,
    ]);
    expect(() => context.putImageData({} as LynxImageData, 0, 0)).toThrow(
      TypeError,
    );
    expect(() => context.putImageData(null as never, 0, 0)).toThrow(TypeError);
  });

  it('makes ImageData', () => {
    const context = make();
    // -2.5 is a long of -2, and the size is its magnitude.
    const data = context.createImageData(-2.5, 3);
    expect([
      data.width,
      data.height,
      data.data.length,
      data.colorSpace,
    ]).toEqual([2, 3, 24, 'srgb']);
    expect(context.createImageData(data).width).toBe(2);
    expect(new LynxImageData(new Uint8ClampedArray(8), 1).height).toBe(2);
    expect(new LynxImageData(new Uint8ClampedArray(8), 1, 2).width).toBe(1);
    expect(() => new LynxImageData(0, 1)).toThrow(/source width/);
    expect(() => new LynxImageData(1, 0)).toThrow(/source height/);
    expect(() => new LynxImageData([] as never, 1)).toThrow(
      /Uint8ClampedArray/,
    );
    expect(() => new LynxImageData(new Uint8ClampedArray(6), 1)).toThrow(
      /multiple of 4\./,
    );
    expect(() => new LynxImageData(new Uint8ClampedArray(0), 1)).toThrow(
      /multiple of 4\./,
    );
    expect(() => new LynxImageData(new Uint8ClampedArray(8), 3)).toThrow(
      /4 \* width\)/,
    );
    expect(() => new LynxImageData(new Uint8ClampedArray(8), 1, 3)).toThrow(
      /width \* height/,
    );
  });

  it('sends what it has when asked, encodes the bitmap, and stops when destroyed', async () => {
    const context = make();
    context.fillRect(0, 0, 1, 1);
    context.flush();
    expect(bridge.batches.length).toBe(1);
    expect(context.encode('image/png', 0.9)).toEqual({
      base64: 'AQI=',
      type: 'image/png',
    });
    expect(bridge.encode2D).toHaveBeenCalledWith(7, {
      type: 'image/png',
      quality: 0.9,
    });
    context.destroy();
    context.destroy();
    expect(bridge.destroy2D).toHaveBeenCalledTimes(1);
    expect(context.encode('image/png', 1)).toEqual({
      error: 'The canvas has no 2D context',
    });
    context.fillRect(0, 0, 1, 1);
    context.flush();
    expect(context.measureText('x').width).toBe(0);
    await Promise.resolve();
    // The task's end, after it went, sends nothing.
    context.globalAlpha = 0.1;
    expect(bridge.batches.length).toBe(1);
  });

  it('drops the end of a task after the context went', async () => {
    const context = make();
    context.fillRect(0, 0, 1, 1);
    context.destroy();
    await Promise.resolve();
    expect(bridge.batches).toEqual([]);
  });
});

describe('LynxDOMMatrix', () => {
  it('has DOMMatrix’s 2D members', () => {
    const matrix = new LynxDOMMatrix([2, 0, 0, 2, 3, 4]);
    expect([
      matrix.m11,
      matrix.m12,
      matrix.m21,
      matrix.m22,
      matrix.m41,
      matrix.m42,
    ]).toEqual([2, 0, 0, 2, 3, 4]);
    expect(matrix.is2D).toBe(true);
    expect(matrix.isIdentity).toBe(false);
    expect(new LynxDOMMatrix().isIdentity).toBe(true);
    expect(matrix.transformPoint({ x: 1, y: 1 })).toEqual({
      x: 5,
      y: 6,
      z: 0,
      w: 1,
    });
    expect(matrix.transformPoint()).toEqual({ x: 3, y: 4, z: 0, w: 1 });
    expect(matrix.inverse().transformPoint({ x: 5, y: 6 })).toMatchObject({
      x: 1,
      y: 1,
    });
    expect(new LynxDOMMatrix([0, 0, 0, 0, 0, 0]).inverse().a).toBeNaN();
    expect(matrix.multiply({ e: 1 }).e).toBe(5);
    expect(matrix.translate(1, 1).f).toBe(6);
    expect(matrix.translate().f).toBe(4);
    expect(matrix.scale(2).a).toBe(4);
    expect(matrix.scale(2, 3).d).toBe(6);
    expect(matrix.scale().a).toBe(2);
    expect(Math.round(matrix.rotate(90).b)).toBe(2);
    expect(matrix.rotate().a).toBe(2);
    expect(String(matrix)).toBe('matrix(2, 0, 0, 2, 3, 4)');
  });
});
