import {
  type DestroyableInjector,
  Injector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxGlobalData } from '../data-flow/global-data';
import { LynxAppState } from './app-state';

/**
 * A page document whose visibility a test can change, like a browser's.
 */
const fakeDocument = (visibilityState: string) => {
  const listeners = new Set<() => void>();
  return {
    visibilityState,
    addEventListener: vi.fn((_type: string, fn: () => void) =>
      listeners.add(fn),
    ),
    removeEventListener: vi.fn((_type: string, fn: () => void) =>
      listeners.delete(fn),
    ),
    show(next: string) {
      this.visibilityState = next;
      for (const fn of listeners) fn();
    },
  };
};

const stubWebPage = (document: object | undefined) => {
  vi.stubGlobal('__WEB__', true);
  vi.stubGlobal('__GetPageElement', () =>
    document ? { ownerDocument: document } : undefined,
  );
};

const create = (globalData = signal<Record<string, unknown>>({})) => {
  const injector = Injector.create({
    providers: [{ provide: LynxGlobalData, useValue: { globalData } }],
  }) as DestroyableInjector;
  const appState = runInInjectionContext(injector, () => new LynxAppState());
  return { appState, globalData, injector };
};

describe('LynxAppState', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('on native Lynx', () => {
    it('is active when the host sends no state, as Lynx Explorer does', () => {
      vi.stubGlobal('__WEB__', false);
      const { appState } = create();

      expect(appState.state()).toBe('active');
      expect(appState.active()).toBe(true);
    });

    it("starts from the state in the host's global props", () => {
      vi.stubGlobal('__WEB__', false);
      const { appState } = create(signal({ appState: 'background' }));

      expect(appState.state()).toBe('background');
      expect(appState.active()).toBe(false);
    });

    it('follows the state as the host sends it again', () => {
      vi.stubGlobal('__WEB__', false);
      const { appState, globalData } = create(signal({ appState: 'active' }));

      globalData.set({ appState: 'inactive' });
      expect(appState.state()).toBe('inactive');
      expect(appState.active()).toBe(false);

      globalData.set({ appState: 'background' });
      expect(appState.state()).toBe('background');
      expect(appState.active()).toBe(false);

      globalData.set({ appState: 'active' });
      expect(appState.state()).toBe('active');
      expect(appState.active()).toBe(true);
    });

    it('ignores a state it does not know', () => {
      vi.stubGlobal('__WEB__', false);
      const { appState } = create(signal({ appState: 'suspended' }));

      expect(appState.state()).toBe('active');
    });
  });

  describe('in the web preview', () => {
    it("follows the page's visibility", () => {
      const document = fakeDocument('visible');
      stubWebPage(document);
      const { appState } = create();

      expect(appState.state()).toBe('active');

      document.show('hidden');
      expect(appState.state()).toBe('background');
      expect(appState.active()).toBe(false);

      document.show('visible');
      expect(appState.active()).toBe(true);
    });

    it('starts in the background on a hidden page', () => {
      stubWebPage(fakeDocument('hidden'));
      const { appState } = create();

      expect(appState.state()).toBe('background');
    });

    it('lets a state the host sends win over the visibility', () => {
      stubWebPage(fakeDocument('visible'));
      const { appState } = create(signal({ appState: 'inactive' }));

      expect(appState.state()).toBe('inactive');
    });

    it('stops listening when its injector is destroyed', () => {
      const document = fakeDocument('visible');
      stubWebPage(document);
      const { injector } = create();

      injector.destroy();

      expect(document.removeEventListener).toHaveBeenCalledWith(
        'visibilitychange',
        document.addEventListener.mock.calls[0][1],
      );
    });

    it('is active when the page has no document to read', () => {
      stubWebPage(undefined);
      const { appState } = create();

      expect(appState.state()).toBe('active');
    });

    it('is active when the page element is not there yet', () => {
      vi.stubGlobal('__WEB__', true);
      vi.stubGlobal('__GetPageElement', undefined);
      const { appState } = create();

      expect(appState.state()).toBe('active');
    });
  });
});
