import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setWebGLBridgeForTesting } from '../../canvas/webgl-bridge';
import { createFakeWebGLBridge } from '../../testing/fake-webgl-bridge';
import type { ElementRef } from '../../types/lynx';
import { createCanvasElement } from './create-canvas-element';

const canvas = { canvas: true } as unknown as ElementRef;
const view = { view: true } as unknown as ElementRef;

describe('createCanvasElement', () => {
  beforeEach(() => {
    globalThis.__CreateElement = vi.fn(() => canvas);
    globalThis.__CreateView = vi.fn(() => view);
  });

  afterEach(() => {
    setWebGLBridgeForTesting(undefined);
    vi.unstubAllGlobals();
  });

  it('makes the shell’s canvas where it has WebGL', () => {
    setWebGLBridgeForTesting(createFakeWebGLBridge());
    expect(createCanvasElement(1)).toBe(canvas);
    expect(globalThis.__CreateElement).toHaveBeenCalledWith('canvas', 1);
  });

  it('makes a view on a host without it, such as Lynx Explorer', () => {
    // An element nothing is registered for stops the rest rendering on Android.
    setWebGLBridgeForTesting(null);
    expect(createCanvasElement(1)).toBe(view);
    expect(globalThis.__CreateView).toHaveBeenCalledWith(1);
  });

  it('makes an HTML canvas on Lynx for Web', () => {
    vi.stubGlobal('__WEB__', true);
    setWebGLBridgeForTesting(null);
    expect(createCanvasElement(1)).toBe(canvas);
  });
});
