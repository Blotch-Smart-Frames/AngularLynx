import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyGlobalDataUpdate } from '../data-flow/host-updates';
import type * as lynxElement from '../lynx-element';
import { LynxElement, scheduleSettleFlush } from '../lynx-element';
import {
  setSafeAreaInsets,
  withSafeAreaInsets,
} from '../lynx-element/safe-area-insets';
import type { ElementRef } from '../types/lynx';
import { followSafeAreaInsets } from './page-safe-area';

vi.mock('../lynx-element', async (importOriginal) => ({
  ...(await importOriginal<typeof lynxElement>()),
  scheduleSettleFlush: vi.fn(),
}));

const variables = (top: number, bottom: number) =>
  [
    `--angular-lynx-safe-area-inset-top: ${top}px`,
    '--angular-lynx-safe-area-inset-right: 0px',
    `--angular-lynx-safe-area-inset-bottom: ${bottom}px`,
    '--angular-lynx-safe-area-inset-left: 0px',
  ].join('; ');

const props = (top: number, bottom: number) => ({
  edgeToEdge: true,
  safeAreaTop: top,
  safeAreaRight: 0,
  safeAreaBottom: bottom,
  safeAreaLeft: 0,
});

describe('followSafeAreaInsets', () => {
  let nextId = 1;
  const page = (): LynxElement => new LynxElement({} as ElementRef);

  beforeEach(() => {
    const ids = new WeakMap<object, number>();
    globalThis.__GetElementUniqueID = vi.fn((ref: object) => {
      if (!ids.has(ref)) ids.set(ref, nextId++);
      return ids.get(ref)!;
    });
    globalThis.__SetInlineStyles = vi.fn();
    globalThis.__AddInlineStyle = vi.fn();
    vi.mocked(scheduleSettleFlush).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setSafeAreaInsets(undefined);
  });

  // The shell sends its global props with the bundle, so the first frame
  // already pads for the insets.
  it('gives the app the insets the host sent before it started', () => {
    vi.stubGlobal('lynx', { __globalProps: props(62, 34) });
    const root = page();

    followSafeAreaInsets(root);

    expect(globalThis.__SetInlineStyles).toHaveBeenCalledWith(
      root.element,
      variables(62, 34),
    );
    expect(withSafeAreaInsets('env(safe-area-inset-bottom)')).toBe('34px');
  });

  // On rotation, and on iOS once the view is in its window.
  it('gives it the new insets whenever the host sends them, and flushes them', () => {
    vi.stubGlobal('lynx', { __globalProps: props(0, 0) });
    const root = page();
    followSafeAreaInsets(root);
    const refresh = vi.spyOn(LynxElement, 'refreshSafeAreaInsets');

    applyGlobalDataUpdate(props(0, 21));

    expect(globalThis.__SetInlineStyles).toHaveBeenLastCalledWith(
      root.element,
      variables(0, 21),
    );
    // And the inline styles that read them.
    expect(refresh).toHaveBeenCalledTimes(1);
    // The update arrives outside change detection.
    expect(scheduleSettleFlush).toHaveBeenCalledTimes(1);
  });

  it('does nothing when an update keeps the insets', () => {
    vi.stubGlobal('lynx', { __globalProps: props(62, 34) });
    followSafeAreaInsets(page());
    vi.mocked(globalThis.__SetInlineStyles).mockClear();
    const refresh = vi.spyOn(LynxElement, 'refreshSafeAreaInsets');

    applyGlobalDataUpdate({ ...props(62, 34), theme: 'Dark' });

    expect(globalThis.__SetInlineStyles).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(scheduleSettleFlush).not.toHaveBeenCalled();
  });

  // A hot update's app takes over the page; a test's new app gets its own.
  it('follows only the newest page', () => {
    vi.stubGlobal('lynx', { __globalProps: props(62, 34) });
    const first = page();
    followSafeAreaInsets(first);
    const second = page();
    followSafeAreaInsets(second);
    vi.mocked(globalThis.__SetInlineStyles).mockClear();

    applyGlobalDataUpdate(props(0, 21));

    expect(vi.mocked(globalThis.__SetInlineStyles).mock.calls).toEqual([
      [second.element, variables(0, 21)],
    ]);
  });

  // Lynx Explorer and the web preview send no edgeToEdge, and unit tests
  // have no lynx at all: env() keeps its own value there.
  it('sets nothing where the host sends no edgeToEdge', () => {
    vi.stubGlobal('lynx', { __globalProps: { safeAreaTop: 62 } });
    followSafeAreaInsets(page());
    vi.stubGlobal('lynx', undefined);
    followSafeAreaInsets(page());

    expect(globalThis.__SetInlineStyles).not.toHaveBeenCalled();
    expect(withSafeAreaInsets('env(safe-area-inset-top)')).toBe(
      'env(safe-area-inset-top)',
    );
  });
});
