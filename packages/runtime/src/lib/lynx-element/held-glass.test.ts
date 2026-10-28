import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markFirstRenderComplete,
  setInsideChangeDetection,
} from '../lynx-render-lifecycle';
import type { ElementRef } from '../types/lynx';
import {
  LynxElement,
  releaseHeldGlass,
  scheduleSettleFlush,
} from './lynx-element';

/**
 * On iOS, a blur-view the first render didn't draw gets its glass effect
 * only after the flush that draws it: iOS draws nothing for one whose first
 * flush already has glass (see LynxElement.#blurViewsToDraw). The first
 * render's latch is module-wide and never resets, so the first test checks
 * the first render, and the rest run after it.
 */

let refs = 0;
const makeRef = () => ({ id: ++refs }) as unknown as ElementRef;

const blurView = () => {
  const view = new LynxElement(makeRef());
  view.tagName = 'blur-view';
  view.holdGlassUntilDrawn();
  return view;
};

/**
 * The `blur-effect` values set on the native element, in order.
 */
const effectsOf = (view: LynxElement) =>
  vi
    .mocked(globalThis.__SetAttribute)
    .mock.calls.filter(
      ([element, name]) => element === view.element && name === 'blur-effect',
    )
    .map(([, , value]) => value);

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(() => resolve()));

beforeEach(() => {
  const ids = new WeakMap<object, number>();
  let next = 1;
  vi.stubGlobal(
    '__GetElementUniqueID',
    vi.fn((ref: object) => {
      if (!ids.has(ref)) ids.set(ref, next++);
      return ids.get(ref);
    }),
  );
  vi.stubGlobal('__SetAttribute', vi.fn());
  vi.stubGlobal('__SetInlineStyles', vi.fn());
  vi.stubGlobal('__FlushElementTree', vi.fn());
  vi.stubGlobal(
    '__GetParent',
    vi.fn(() => null),
  );
  vi.stubGlobal('__RemoveElement', vi.fn());
  vi.stubGlobal('__WEB__', false);
  vi.stubGlobal('lynx', { SystemInfo: { platform: 'iOS' } });
});

afterEach(() => {
  // Leave nothing held for the next test.
  releaseHeldGlass();
  vi.unstubAllGlobals();
});

describe('glass on iOS blur-views', () => {
  it('goes to a blur-view at once in the first render, when the page is not on screen yet', () => {
    const view = blurView();
    view.setAttribute('blur-effect', 'glass');

    expect(effectsOf(view)).toEqual(['glass']);
    expect(releaseHeldGlass()).toBe(false);
  });

  it('waits for the flush that draws a blur-view created after the first render', () => {
    markFirstRenderComplete();
    const view = blurView();
    view.setAttribute('blur-effect', 'glass');
    view.setAttribute('blur-radius', '16px');

    // The other attributes go to the element; the glass waits.
    expect(effectsOf(view)).toEqual([]);
    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
      view.element,
      'blur-radius',
      '16px',
    );

    expect(releaseHeldGlass()).toBe(true);
    expect(effectsOf(view)).toEqual(['glass']);
    // Released once: nothing is left for the next flush.
    expect(releaseHeldGlass()).toBe(false);
  });

  it('holds a glass container the same way', () => {
    const view = blurView();
    view.setAttribute('blur-effect', 'glass-container');

    expect(effectsOf(view)).toEqual([]);
    releaseHeldGlass();
    expect(effectsOf(view)).toEqual(['glass-container']);
  });

  it('sets a blur effect at once, in place of glass it was holding', () => {
    const view = blurView();
    view.setAttribute('blur-effect', 'glass');
    view.setAttribute('blur-effect', 'dark');

    expect(effectsOf(view)).toEqual(['dark']);
    expect(releaseHeldGlass()).toBe(false);
    expect(effectsOf(view)).toEqual(['dark']);
  });

  it('sets glass at once on a blur-view that is already drawn', () => {
    const view = blurView();
    view.setAttribute('blur-effect', 'light');
    releaseHeldGlass();

    view.setAttribute('blur-effect', 'glass');
    expect(effectsOf(view)).toEqual(['light', 'glass']);
  });

  it('gives no glass to a blur-view removed before it was drawn', () => {
    const parentRef = makeRef();
    const parent = new LynxElement(parentRef);
    const view = blurView();
    vi.mocked(globalThis.__GetParent).mockImplementation((ref) =>
      ref === view.element ? parentRef : null,
    );
    view.setAttribute('blur-effect', 'glass');
    view.remove();
    LynxElement.commitPendingRemovals();

    expect(globalThis.__RemoveElement).toHaveBeenCalledWith(
      parent.element,
      view.element,
    );
    expect(releaseHeldGlass()).toBe(false);
    expect(effectsOf(view)).toEqual([]);
  });

  it('holds nothing on Android or the web, which draw glass their own way', () => {
    vi.stubGlobal('lynx', { SystemInfo: { platform: 'Android' } });
    const android = blurView();
    android.setAttribute('blur-effect', 'glass');
    expect(effectsOf(android)).toEqual(['glass']);

    vi.stubGlobal('lynx', { SystemInfo: { platform: 'iOS' } });
    vi.stubGlobal('__WEB__', true);
    const web = blurView();
    web.setAttribute('blur-effect', 'glass');
    expect(effectsOf(web)).toEqual(['glass']);
  });

  it('is released by the settle flush, which flushes again for it', async () => {
    setInsideChangeDetection(false);
    const view = blurView();
    view.setAttribute('blur-effect', 'glass');

    scheduleSettleFlush();
    await flushMicrotasks();

    expect(effectsOf(view)).toEqual(['glass']);
    expect(globalThis.__FlushElementTree).toHaveBeenCalledTimes(2);
  });

  it('lets the settle flush flush once when nothing is held', async () => {
    setInsideChangeDetection(false);
    scheduleSettleFlush();
    await flushMicrotasks();

    expect(globalThis.__FlushElementTree).toHaveBeenCalledTimes(1);
  });
});
