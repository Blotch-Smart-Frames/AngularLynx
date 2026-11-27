import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeWebGLBridge,
  type FakeWebGLBridge,
} from '../testing/fake-webgl-bridge';
import type { ElementRef } from '../types/lynx';
import { LynxCanvasElement } from './canvas-element';
import { setWebGL2ContextFactory } from './canvas-surface';
import { ɵenableWebGL2 } from './enable-webgl2';
import { setWebGLBridgeForTesting } from './webgl-bridge';
import { LynxWebGL2RenderingContext } from './webgl2-context';

const canvasWithBridge = (): {
  canvas: LynxCanvasElement;
  bridge: FakeWebGLBridge;
} => {
  const bridge = createFakeWebGLBridge();
  setWebGLBridgeForTesting(bridge);
  globalThis.__GetElementUniqueID = vi.fn(() => 1);
  globalThis.__SetAttribute = vi.fn();
  globalThis.__AddEvent = vi.fn();
  globalThis.__SetDataset = vi.fn();
  globalThis.__InvokeUIMethod = vi.fn();
  return { canvas: new LynxCanvasElement({} as ElementRef), bridge };
};

afterEach(() => {
  setWebGLBridgeForTesting(undefined);
  setWebGL2ContextFactory(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ɵenableWebGL2', () => {
  it('gives a canvas its WebGL2 context, with the attributes it asked for', () => {
    const { canvas, bridge } = canvasWithBridge();
    ɵenableWebGL2();
    // A second module that names 'webgl2' calls it again.
    ɵenableWebGL2();
    const gl = canvas.getContext('webgl2', {
      alpha: false,
    }) as LynxWebGL2RenderingContext;
    expect(gl).toBeInstanceOf(LynxWebGL2RenderingContext);
    expect(gl.canvas).toBe(canvas);
    expect(gl.getContextAttributes()).toMatchObject({ alpha: false });
    expect(bridge.create).toHaveBeenCalledTimes(1);
  });

  it('leaves a canvas without a WebGL2 context until it’s called, and says so once', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { canvas, bridge } = canvasWithBridge();
    const failed = vi.fn();
    canvas.addEventListener('webglcontextcreationerror', failed);
    expect(canvas.getContext('webgl2')).toBeNull();
    expect(canvas.getContext('webgl2')).toBeNull();
    expect(bridge.create).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("names 'webgl2'"),
    );
    ɵenableWebGL2();
    expect(canvas.getContext('webgl2')).toBeInstanceOf(
      LynxWebGL2RenderingContext,
    );
  });

  it('does nothing on Lynx for Web, where the canvas is the browser’s', () => {
    vi.stubGlobal('__WEB__', true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    ɵenableWebGL2();
    vi.stubGlobal('__WEB__', false);
    const { canvas } = canvasWithBridge();
    expect(canvas.getContext('webgl2')).toBeNull();
  });
});
