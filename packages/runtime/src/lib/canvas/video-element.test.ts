import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { canvasSourceOf } from './canvas-source';
import { installCanvasGlobals } from './dom-globals';
import { LynxVideoElement } from './video-element';
import { setVideoFrameSizeForTesting } from './webgl-bridge';

let size = { width: 0, height: 0 };
let uid = 1;

beforeEach(() => {
  size = { width: 0, height: 0 };
  setVideoFrameSizeForTesting(() => size);
  globalThis.__SetAttribute = vi.fn();
  globalThis.__GetElementUniqueID = vi.fn(() => uid++);
});

afterEach(() => {
  setVideoFrameSizeForTesting(undefined);
  vi.restoreAllMocks();
});

describe('LynxVideoElement', () => {
  it('pairs itself with the shell’s view by an id of its own', () => {
    const ref = {} as ElementRef;
    const video = new LynxVideoElement(ref);
    expect(video.tagName).toBe('video');
    expect(video.videoId).toMatch(/^v[0-9a-z]+-\d+$/);
    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
      ref,
      'video-id',
      video.videoId,
    );
    expect(new LynxVideoElement({} as ElementRef).videoId).not.toBe(
      video.videoId,
    );
  });

  it('has no frame until the shell has one, then its size', () => {
    const video = new LynxVideoElement({} as ElementRef);
    expect([video.videoWidth, video.videoHeight]).toEqual([0, 0]);
    expect(video.readyState).toBe(video.HAVE_NOTHING);
    // three.js's VideoTexture uploads while it's at least HAVE_CURRENT_DATA.
    size = { width: 1280, height: 720 };
    expect([video.videoWidth, video.videoHeight]).toEqual([1280, 720]);
    expect(video.readyState).toBeGreaterThanOrEqual(video.HAVE_CURRENT_DATA);
    expect(video.readyState).toBe(video.HAVE_ENOUGH_DATA);
    expect([video.HAVE_METADATA, video.HAVE_FUTURE_DATA]).toEqual([1, 3]);
  });

  it('is read as an image by its id, at its frame’s size now', () => {
    const video = new LynxVideoElement({} as ElementRef);
    size = { width: 4, height: 3 };
    const source = canvasSourceOf(video)!;
    expect(source).toMatchObject({
      canvasId: video.videoId,
      width: 4,
      height: 3,
      readable: true,
      video: true,
    });
    expect(() => source.flush()).not.toThrow();
    size = { width: 8, height: 6 };
    expect(canvasSourceOf(video)!.width).toBe(8);
  });

  it('is an HTMLVideoElement, and not an HTMLCanvasElement', () => {
    const target: Record<string, any> = {};
    installCanvasGlobals(target);
    const video = new LynxVideoElement({} as ElementRef);
    expect(video instanceof target['HTMLVideoElement']).toBe(true);
    expect(video instanceof target['HTMLCanvasElement']).toBe(false);
    expect({ tagName: 'video' } instanceof target['HTMLVideoElement']).toBe(
      false,
    );
    expect(null instanceof target['HTMLVideoElement']).toBe(false);
    // Its readyState constants are on the interface too, as on the web.
    expect([
      target['HTMLVideoElement'].HAVE_NOTHING,
      target['HTMLVideoElement'].HAVE_METADATA,
      target['HTMLVideoElement'].HAVE_CURRENT_DATA,
      target['HTMLVideoElement'].HAVE_FUTURE_DATA,
      target['HTMLVideoElement'].HAVE_ENOUGH_DATA,
    ]).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('LynxVideoElement on Lynx for Web', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is the browser’s video', () => {
    vi.stubGlobal('__WEB__', true);
    const dom = { videoWidth: 320, videoHeight: 180, readyState: 3 };
    const video = new LynxVideoElement(dom as unknown as ElementRef);
    expect([video.videoWidth, video.videoHeight]).toEqual([320, 180]);
    expect(video.readyState).toBe(3);
    // The browser's canvas reads it: there's no id for the shell.
    expect(canvasSourceOf(video)).toBeNull();
    expect(globalThis.__SetAttribute).not.toHaveBeenCalled();
  });
});
