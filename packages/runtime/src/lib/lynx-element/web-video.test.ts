import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

describe('<video> events on Lynx for Web', () => {
  /** The handler registered natively for each event name, as web-core keeps it. */
  let handlers: Map<string, (event: unknown) => unknown>;
  /** What the web preview's HTMLVideoElement has to read. */
  let video: {
    currentTime: number;
    duration: number;
    error: { code: number; message: string } | null;
  };

  const videoElement = (web: boolean): LynxElement => {
    vi.stubGlobal('__WEB__', web);
    const element = new LynxElement(video as unknown as ElementRef);
    element.tagName = 'video';
    return element;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    handlers = new Map();
    video = { currentTime: 0, duration: NaN, error: null };
    let nextId = 1;
    vi.stubGlobal('__GetElementUniqueID', () => nextId++);
    vi.stubGlobal(
      '__AddEvent',
      (
        _element: ElementRef,
        _type: string,
        name: string,
        handler?: { value: (event: unknown) => unknown },
      ) => {
        if (handler) handlers.set(name, handler.value);
      },
    );
    vi.stubGlobal('__FlushElementTree', () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * web-core sends `detail: domEvent.detail ?? {}`, and a media event has no
   * detail.
   */
  const fireEvent = (name: string) =>
    handlers.get(name)!({ type: name, detail: {} });

  it('sends bindtimeupdate the position and duration, in seconds', () => {
    const element = videoElement(true);
    const listener = vi.fn();
    element.addEventListener('bindtimeupdate', listener);

    // Before the metadata loads, the browser's duration is NaN.
    fireEvent('timeupdate');
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: { current: 0, duration: 0 } }),
    );

    video.currentTime = 1.5;
    video.duration = 5.2;
    fireEvent('timeupdate');
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: { current: 1.5, duration: 5.2 } }),
    );
  });

  it("sends binderror the browser's error", () => {
    const element = videoElement(true);
    const listener = vi.fn();
    element.addEventListener('binderror', listener);

    video.error = { code: 4, message: 'Format error' };
    fireEvent('error');
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: { errorCode: 4, errorMsg: 'Format error' },
      }),
    );

    video.error = null;
    fireEvent('error');
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: { errorCode: 0, errorMsg: '' } }),
    );
  });

  it('leaves the detail of other events alone', () => {
    const element = videoElement(true);
    const listener = vi.fn();
    element.addEventListener('bindended', listener);

    fireEvent('ended');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: {} }),
    );
  });

  it("leaves native Lynx's detail alone", () => {
    const element = videoElement(false);
    const listener = vi.fn();
    element.addEventListener('bindtimeupdate', listener);

    handlers.get('timeupdate')!({
      type: 'timeupdate',
      detail: { current: 2, duration: 9 },
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { current: 2, duration: 9 } }),
    );
  });

  it('leaves other elements alone', () => {
    vi.stubGlobal('__WEB__', true);
    const element = new LynxElement(video as unknown as ElementRef);
    element.tagName = 'view';
    const listener = vi.fn();
    element.addEventListener('binderror', listener);

    fireEvent('error');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: {} }),
    );
  });
});
