import {
  type DestroyableInjector,
  Injector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxGlobalData } from '../data-flow/global-data';
import { LynxAccessibilitySettings } from './accessibility-settings';

/**
 * A media query list a test can flip, like a browser's.
 */
const fakeQuery = (matches: boolean) => {
  const listeners = new Set<() => void>();
  return {
    matches,
    addEventListener: vi.fn((_type: string, fn: () => void) =>
      listeners.add(fn),
    ),
    removeEventListener: vi.fn((_type: string, fn: () => void) =>
      listeners.delete(fn),
    ),
    flip(next: boolean) {
      this.matches = next;
      for (const fn of listeners) fn();
    },
  };
};

/**
 * A page window whose media queries are `queries`, by query text.
 */
const stubWebPage = (queries: Record<string, ReturnType<typeof fakeQuery>>) => {
  vi.stubGlobal('__WEB__', true);
  vi.stubGlobal('__GetPageElement', () => ({
    ownerDocument: {
      defaultView: { matchMedia: (query: string) => queries[query] },
    },
  }));
};

const create = (globalData = signal<Record<string, unknown>>({})) => {
  const injector = Injector.create({
    providers: [{ provide: LynxGlobalData, useValue: { globalData } }],
  }) as DestroyableInjector;
  const settings = runInInjectionContext(
    injector,
    () => new LynxAccessibilitySettings(),
  );
  return { settings, globalData, injector };
};

describe('LynxAccessibilitySettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('on native Lynx', () => {
    it('is all off when the host sends none of the settings', () => {
      vi.stubGlobal('__WEB__', false);
      const { settings } = create();

      expect(settings.reduceMotion()).toBe(false);
      expect(settings.reduceTransparency()).toBe(false);
      expect(settings.increaseContrast()).toBe(false);
    });

    it("follows the host's global props as they change", () => {
      vi.stubGlobal('__WEB__', false);
      const { settings, globalData } = create(
        signal({ reduceMotion: true, increaseContrast: false }),
      );

      expect(settings.reduceMotion()).toBe(true);
      expect(settings.increaseContrast()).toBe(false);

      globalData.set({ reduceTransparency: true, increaseContrast: true });

      expect(settings.reduceMotion()).toBe(false);
      expect(settings.reduceTransparency()).toBe(true);
      expect(settings.increaseContrast()).toBe(true);
    });

    it("takes 'true', as Lynx Explorer passes a bundle URL's query parameters", () => {
      vi.stubGlobal('__WEB__', false);
      const { settings } = create(
        signal({ reduceMotion: 'true', reduceTransparency: 'false' }),
      );

      expect(settings.reduceMotion()).toBe(true);
      expect(settings.reduceTransparency()).toBe(false);
    });
  });

  describe('textScale', () => {
    it('is 1, the system default, when the host sends none', () => {
      vi.stubGlobal('__WEB__', false);
      expect(create().settings.textScale()).toBe(1);
    });

    // The shells send it again when the user changes the text size while
    // the app is open.
    it("follows the host's textScale as it changes", () => {
      vi.stubGlobal('__WEB__', false);
      const { settings, globalData } = create(signal({ textScale: 1.35 }));

      expect(settings.textScale()).toBe(1.35);

      globalData.set({ textScale: 0.82 });

      expect(settings.textScale()).toBe(0.82);
    });

    it("takes a number's text, as Lynx Explorer passes a bundle URL's query parameters", () => {
      vi.stubGlobal('__WEB__', false);
      expect(create(signal({ textScale: '1.5' })).settings.textScale()).toBe(
        1.5,
      );
    });

    it.each([
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      ' ',
      'large',
      true,
      null,
    ])('is 1 for %s, which is no scale', (textScale) => {
      vi.stubGlobal('__WEB__', false);
      expect(create(signal({ textScale })).settings.textScale()).toBe(1);
    });
  });

  describe('in the web preview', () => {
    it("follows the page's media queries, and stops listening when destroyed", () => {
      const motion = fakeQuery(true);
      const transparency = fakeQuery(false);
      const contrast = fakeQuery(false);
      stubWebPage({
        '(prefers-reduced-motion: reduce)': motion,
        '(prefers-reduced-transparency: reduce)': transparency,
        '(prefers-contrast: more)': contrast,
      });
      const { settings, injector } = create();

      expect(settings.reduceMotion()).toBe(true);
      expect(settings.reduceTransparency()).toBe(false);

      transparency.flip(true);
      contrast.flip(true);
      motion.flip(false);

      expect(settings.reduceTransparency()).toBe(true);
      expect(settings.increaseContrast()).toBe(true);
      expect(settings.reduceMotion()).toBe(false);

      injector.destroy();
      expect(motion.removeEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );
    });

    it('also takes the host app’s global props there', () => {
      stubWebPage({
        '(prefers-reduced-motion: reduce)': fakeQuery(false),
        '(prefers-reduced-transparency: reduce)': fakeQuery(false),
        '(prefers-contrast: more)': fakeQuery(false),
      });
      const { settings } = create(signal({ increaseContrast: true }));

      expect(settings.increaseContrast()).toBe(true);
    });

    it('is off where the page has no window or no media queries', () => {
      vi.stubGlobal('__WEB__', true);
      vi.stubGlobal('__GetPageElement', () => undefined);
      expect(create().settings.reduceMotion()).toBe(false);

      vi.stubGlobal('__GetPageElement', () => ({
        ownerDocument: { defaultView: {} },
      }));
      expect(create().settings.reduceMotion()).toBe(false);

      vi.stubGlobal('__GetPageElement', () => ({ ownerDocument: {} }));
      expect(create().settings.increaseContrast()).toBe(false);

      vi.stubGlobal('__GetPageElement', undefined);
      expect(create().settings.reduceTransparency()).toBe(false);
    });
  });
});
