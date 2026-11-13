import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyGlobalDataUpdate } from '../data-flow/host-updates';
import type * as lynxElement from '../lynx-element';
import { LynxElement, scheduleSettleFlush } from '../lynx-element';
import {
  setColorSchemePreference,
  watchBrowserColorScheme,
} from '../theme/color-scheme';
import type { ElementRef } from '../types/lynx';
import { DARK_CLASS, followColorScheme } from './page-color-scheme';

vi.mock('../lynx-element', async (importOriginal) => ({
  ...(await importOriginal<typeof lynxElement>()),
  scheduleSettleFlush: vi.fn(),
}));

/**
 * A media query list a test can flip, like a browser's.
 */
const fakeQuery = (matches: boolean) => {
  const listeners = new Set<() => void>();
  return {
    matches,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) =>
      listeners.delete(fn),
    flip(next: boolean) {
      this.matches = next;
      for (const fn of listeners) fn();
    },
  };
};

describe('followColorScheme', () => {
  /** Each page's classes, as the engine holds them. */
  let classes: WeakMap<object, string[]>;
  const page = (ref: object = {}): LynxElement =>
    new LynxElement(ref as ElementRef);
  const isDark = (element: LynxElement): boolean =>
    classes.get(element.element)?.includes(DARK_CLASS) ?? false;

  beforeEach(() => {
    let nextId = 1;
    const ids = new WeakMap<object, number>();
    classes = new WeakMap();
    globalThis.__GetElementUniqueID = vi.fn((ref: object) => {
      if (!ids.has(ref)) ids.set(ref, nextId++);
      return ids.get(ref)!;
    });
    globalThis.__AddClass = vi.fn((ref: object, name: string) => {
      classes.set(ref, [...(classes.get(ref) ?? []), name]);
    });
    globalThis.__GetClasses = vi.fn((ref: object) => classes.get(ref) ?? []);
    globalThis.__SetClasses = vi.fn((ref: object, value: string) => {
      classes.set(ref, value.split(' ').filter(Boolean));
    });
    vi.mocked(scheduleSettleFlush).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setColorSchemePreference('system');
    watchBrowserColorScheme(undefined);
  });

  // The shell sends its global props with the bundle, so the first frame is
  // already dark: no flash of light.
  it('gives the page the dark class when the host started it dark', () => {
    vi.stubGlobal('lynx', { __globalProps: { theme: 'Dark' } });
    const root = page();

    followColorScheme(root);

    expect(isDark(root)).toBe(true);
  });

  it('leaves the page light when the host is, or sends no theme, or there is no host', () => {
    vi.stubGlobal('lynx', { __globalProps: { theme: 'Light' } });
    const light = page();
    followColorScheme(light);
    vi.stubGlobal('lynx', {});
    const none = page();
    followColorScheme(none);
    vi.stubGlobal('lynx', undefined);
    const noHost = page();
    followColorScheme(noHost);

    expect(isDark(light)).toBe(false);
    expect(isDark(none)).toBe(false);
    expect(isDark(noHost)).toBe(false);
  });

  it('follows the phone as it switches, and flushes the change', () => {
    vi.stubGlobal('lynx', { __globalProps: { theme: 'Light' } });
    const root = page();
    followColorScheme(root);

    applyGlobalDataUpdate({ theme: 'Dark' });
    expect(isDark(root)).toBe(true);
    // The update arrives outside change detection.
    expect(scheduleSettleFlush).toHaveBeenCalled();

    applyGlobalDataUpdate({ theme: 'Light' });
    expect(isDark(root)).toBe(false);
  });

  // Most global props updates are something else, such as new insets.
  it('does nothing when an update keeps the theme', () => {
    vi.stubGlobal('lynx', { __globalProps: { theme: 'Dark' } });
    followColorScheme(page());
    vi.mocked(scheduleSettleFlush).mockClear();
    vi.mocked(globalThis.__SetClasses).mockClear();
    vi.mocked(globalThis.__AddClass).mockClear();

    applyGlobalDataUpdate({ theme: 'Dark', safeAreaTop: 62 });

    expect(globalThis.__AddClass).not.toHaveBeenCalled();
    expect(globalThis.__SetClasses).not.toHaveBeenCalled();
    expect(scheduleSettleFlush).not.toHaveBeenCalled();
  });

  it("follows the app's own choice over the phone's", () => {
    vi.stubGlobal('lynx', { __globalProps: { theme: 'Light' } });
    const root = page();
    followColorScheme(root);

    setColorSchemePreference('dark');
    expect(isDark(root)).toBe(true);
    expect(scheduleSettleFlush).toHaveBeenCalled();

    // The phone turning dark and light changes nothing now.
    applyGlobalDataUpdate({ theme: 'Light' });
    expect(isDark(root)).toBe(true);

    setColorSchemePreference('system');
    expect(isDark(root)).toBe(false);
  });

  // An app's own <page class="…"> is written as one class string.
  it("keeps the class through the app's own classes on the page", () => {
    vi.stubGlobal('lynx', { __globalProps: { theme: 'Dark' } });
    const root = page();
    followColorScheme(root);

    root.setAttribute('class', 'app');

    expect(classes.get(root.element)).toEqual(['app', DARK_CLASS]);
  });

  // A hot update's app takes over the page; a test's new app gets its own.
  it('follows only the newest page', () => {
    vi.stubGlobal('lynx', { __globalProps: { theme: 'Light' } });
    const first = page();
    followColorScheme(first);
    const second = page();
    followColorScheme(second);

    applyGlobalDataUpdate({ theme: 'Dark' });

    expect(isDark(first)).toBe(false);
    expect(isDark(second)).toBe(true);
  });

  describe('in the web preview', () => {
    /**
     * A page element in a window whose browser prefers `query`.
     */
    const webPage = (query: ReturnType<typeof fakeQuery>): LynxElement =>
      page({
        ownerDocument: { defaultView: { matchMedia: () => query } },
      });

    beforeEach(() => {
      vi.stubGlobal('__WEB__', true);
      vi.stubGlobal('lynx', { __globalProps: {} });
    });

    // No host sends a theme there.
    it("follows the browser's color scheme", () => {
      const query = fakeQuery(true);
      const root = webPage(query);

      followColorScheme(root);
      expect(isDark(root)).toBe(true);

      query.flip(false);
      expect(isDark(root)).toBe(false);
      expect(scheduleSettleFlush).toHaveBeenCalled();
    });

    it('stays light for a page element with no window', () => {
      const detached = page({});
      const noView = page({ ownerDocument: {} });

      followColorScheme(detached);
      followColorScheme(noView);

      expect(isDark(detached)).toBe(false);
      expect(isDark(noView)).toBe(false);
    });
  });

  // Native Lynx has no windows: an element there has no ownerDocument, and
  // nothing asks for one.
  it("doesn't look for a window on native Lynx", () => {
    vi.stubGlobal('lynx', { __globalProps: {} });
    const ref = {
      get ownerDocument(): never {
        throw new Error('read on native');
      },
    };

    expect(() => followColorScheme(page(ref))).not.toThrow();
  });
});
