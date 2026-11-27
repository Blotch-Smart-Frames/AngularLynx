import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeCanvas2DBridge,
  type FakeCanvas2DBridge,
} from '../testing/fake-canvas-2d-bridge';
import {
  LynxCanvasGradient,
  LynxCanvasPattern,
  LynxCanvasRenderingContext2D,
  LynxTextMetrics,
} from './canvas-2d-context';
import { setCanvas2DContextFactory } from './canvas-surface';
import { LynxDetachedCanvas } from './detached-canvas';
import { install2DGlobals, ɵenableCanvas2D } from './enable-canvas-2d';
import { LynxPath2D } from './path';
import { setCanvas2DBridgeForTesting } from './webgl-bridge';

const NAMES = [
  'CanvasRenderingContext2D',
  'OffscreenCanvasRenderingContext2D',
  'CanvasGradient',
  'CanvasPattern',
  'TextMetrics',
  'Path2D',
];

const canvasWithBridge = (): {
  canvas: LynxDetachedCanvas;
  bridge: FakeCanvas2DBridge;
} => {
  const bridge = createFakeCanvas2DBridge();
  setCanvas2DBridgeForTesting(bridge);
  return { canvas: new LynxDetachedCanvas(), bridge };
};

afterEach(() => {
  setCanvas2DBridgeForTesting(undefined);
  setCanvas2DContextFactory(null);
  for (const name of NAMES) {
    delete (globalThis as Record<string, unknown>)[name];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ɵenableCanvas2D', () => {
  it('gives a canvas its 2D context, with the settings it asked for', () => {
    const { canvas, bridge } = canvasWithBridge();
    ɵenableCanvas2D();
    // A second module that names '2d' calls it again.
    ɵenableCanvas2D();
    const context = canvas.getContext('2d', {
      alpha: false,
    }) as LynxCanvasRenderingContext2D;
    expect(context).toBeInstanceOf(LynxCanvasRenderingContext2D);
    expect(context.canvas).toBe(canvas);
    expect(context.getContextAttributes()).toMatchObject({ alpha: false });
    expect(bridge.create2D).toHaveBeenCalledTimes(1);
  });

  it('puts the context’s classes on globalThis, where the 2D code reads them', () => {
    ɵenableCanvas2D();
    const target = globalThis as Record<string, unknown>;
    expect(target['CanvasRenderingContext2D']).toBe(
      LynxCanvasRenderingContext2D,
    );
    expect(target['OffscreenCanvasRenderingContext2D']).toBe(
      LynxCanvasRenderingContext2D,
    );
    expect(target['CanvasGradient']).toBe(LynxCanvasGradient);
    expect(target['CanvasPattern']).toBe(LynxCanvasPattern);
    expect(target['TextMetrics']).toBe(LynxTextMetrics);
    expect(target['Path2D']).toBe(LynxPath2D);
  });

  it('leaves a canvas without a 2D context until it’s called, and says so once', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { canvas, bridge } = canvasWithBridge();
    expect(canvas.getContext('2d')).toBeNull();
    expect(canvas.getContext('2d')).toBeNull();
    expect(bridge.create2D).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("names '2d'"),
    );
    // The canvas took no kind of context, so it can still take a 2D one.
    ɵenableCanvas2D();
    expect(canvas.getContext('2d')).toBeInstanceOf(
      LynxCanvasRenderingContext2D,
    );
  });

  it('still encodes a canvas nobody drew on, without the context', () => {
    const { canvas, bridge } = canvasWithBridge();
    expect(canvas.toDataURL()).toBe('data:image/png;base64,AQI=');
    expect(bridge.create2D).toHaveBeenCalledTimes(1);
    expect(bridge.destroy2D).toHaveBeenCalledTimes(1);
  });

  it('does nothing on Lynx for Web, where the canvas is the browser’s', () => {
    vi.stubGlobal('__WEB__', true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    ɵenableCanvas2D();
    vi.stubGlobal('__WEB__', false);
    const { canvas } = canvasWithBridge();
    expect(canvas.getContext('2d')).toBeNull();
    for (const name of NAMES) {
      expect(
        (globalThis as Record<string, unknown>)[name],
        name,
      ).toBeUndefined();
    }
  });
});

describe('install2DGlobals', () => {
  it('keeps a class the target has already', () => {
    class Path2D {}
    const target: Record<string, unknown> = { Path2D };
    install2DGlobals(target);
    expect(target['Path2D']).toBe(Path2D);
    expect(target['CanvasRenderingContext2D']).toBe(
      LynxCanvasRenderingContext2D,
    );
  });
});
