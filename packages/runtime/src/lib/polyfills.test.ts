import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The polyfills only install when the guarded browser/timer global is absent, so
 * each test deletes the relevant global (they exist in Node/jsdom), re-imports
 * the module fresh, and asserts the shim was installed. Globals accumulate on
 * globalThis across imports within a file, which is fine — every test deletes
 * its own target immediately before importing.
 */
const importFresh = async (): Promise<void> => {
  vi.resetModules();
  await import('./polyfills');
};

describe('polyfills', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('web secure-context diagnostic', () => {
    it('logs an error when running on web in an insecure context', async () => {
      vi.stubGlobal('__WEB__', true);
      vi.stubGlobal('isSecureContext', false);
      vi.stubGlobal('lynx', undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      await importFresh();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('not running in a secure context'),
      );
      error.mockRestore();
    });

    it('stays silent when on web in a secure context', async () => {
      vi.stubGlobal('__WEB__', true);
      vi.stubGlobal('isSecureContext', true);
      vi.stubGlobal('lynx', undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      await importFresh();
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });

  describe('AbortController', () => {
    it('installs a functional AbortController/AbortSignal pair', async () => {
      delete (globalThis as any).AbortController;
      delete (globalThis as any).AbortSignal;
      vi.stubGlobal('lynx', undefined);
      await importFresh();

      expect((globalThis as any).AbortController).toBeTypeOf('function');

      const controller = new (globalThis as any).AbortController();
      const signal = controller.signal;

      // addEventListener: 'abort' registers, any other type is ignored.
      let notified = false;
      signal.addEventListener('abort', () => {
        notified = true;
      });
      signal.addEventListener('other', () => {});

      /**
       * removeEventListener: both the 'abort' and non-'abort' branches.
       */
      const removable = (): void => {};
      signal.addEventListener('abort', removable);
      signal.removeEventListener('abort', removable);
      signal.removeEventListener('other', removable);

      // dispatchEvent on a non-abort type returns true without notifying.
      expect(signal.dispatchEvent({ type: 'noop' })).toBe(true);
      expect(notified).toBe(false);

      // Not aborted yet: throwIfAborted is a no-op.
      expect(() => signal.throwIfAborted()).not.toThrow();

      // abort() with no reason synthesizes an AbortError and notifies listeners.
      controller.abort();
      expect(notified).toBe(true);
      expect(signal.aborted).toBe(true);
      expect(signal.reason.name).toBe('AbortError');
      expect(() => signal.throwIfAborted()).toThrow();

      // Second abort() is a no-op (already aborted).
      controller.abort('ignored');
      expect(signal.reason.name).toBe('AbortError');
    });

    it('uses an explicit reason when abort(reason) is called', async () => {
      delete (globalThis as any).AbortController;
      delete (globalThis as any).AbortSignal;
      vi.stubGlobal('lynx', undefined);
      await importFresh();

      const controller = new (globalThis as any).AbortController();
      controller.abort('custom-reason');
      expect(controller.signal.reason).toBe('custom-reason');
    });
  });

  describe('URL and URLSearchParams', () => {
    // The install guard itself is tested in url/index.test.ts with a stand-in
    // global: stubbing out the real URL breaks Vitest's module loader.
    it('keeps the platform implementation where one exists', async () => {
      const NativeURL = globalThis.URL;
      const NativeURLSearchParams = globalThis.URLSearchParams;
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect(globalThis.URL).toBe(NativeURL);
      expect(globalThis.URLSearchParams).toBe(NativeURLSearchParams);
    });
  });

  describe('atob, btoa and DOMException', () => {
    // The install guards themselves are tested in network/index.test.ts with
    // a stand-in global. Node has all three, so each test removes them.
    it.each([
      ['main', true],
      ['background', false],
    ])('installs them on the %s thread', async (_thread, mainThread) => {
      vi.stubGlobal('__MAIN_THREAD__', mainThread);
      vi.stubGlobal('atob', undefined);
      vi.stubGlobal('btoa', undefined);
      vi.stubGlobal('DOMException', undefined);
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect(atob(btoa('Hello'))).toBe('Hello');
      expect(() => atob('a')).toThrow(DOMException);
    });

    it("keeps the platform's own", async () => {
      const nativeAtob = globalThis.atob;
      vi.stubGlobal('__MAIN_THREAD__', false);
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect(globalThis.atob).toBe(nativeAtob);
    });
  });

  describe('network APIs', () => {
    // The install guards themselves are tested in network/index.test.ts with
    // a stand-in global. Node has fetch but no XMLHttpRequest, so XHR shows
    // whether they were installed.
    it("installs them on the main thread, keeping the platform's fetch", async () => {
      const nativeFetch = globalThis.fetch;
      vi.stubGlobal('__MAIN_THREAD__', true);
      vi.stubGlobal('XMLHttpRequest', undefined);
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect((globalThis as any).XMLHttpRequest?.name).toBe(
        'LynxXMLHttpRequest',
      );
      expect(globalThis.fetch).toBe(nativeFetch);
    });

    it('leaves the background thread alone', async () => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      vi.stubGlobal('XMLHttpRequest', undefined);
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect((globalThis as any).XMLHttpRequest).toBeUndefined();
    });
  });

  describe('queueMicrotask', () => {
    it('uses lynx.queueMicrotask when available', async () => {
      const lynxQueueMicrotask = vi.fn();
      delete (globalThis as any).queueMicrotask;
      vi.stubGlobal('lynx', { queueMicrotask: lynxQueueMicrotask });
      await importFresh();
      expect(globalThis.queueMicrotask).toBe(lynxQueueMicrotask);
    });

    it('falls back to a Promise-based microtask that reschedules errors', async () => {
      delete (globalThis as any).queueMicrotask;
      vi.stubGlobal('lynx', undefined);
      // Make setTimeout run its callback synchronously (inside a try) so the
      // rethrow path executes without leaking an async error into the test.
      const setTimeoutSpy = vi.fn((cb: () => void) => {
        try {
          cb();
        } catch {
          // swallow the deliberately-rethrown error
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });
      vi.stubGlobal('setTimeout', setTimeoutSpy);
      await importFresh();

      let ran = false;
      globalThis.queueMicrotask(() => {
        ran = true;
      });
      await Promise.resolve();
      expect(ran).toBe(true);

      // Throwing callback → .catch → setTimeout(rethrow).
      globalThis.queueMicrotask(() => {
        throw new Error('microtask boom');
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(setTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Node', () => {
    it('installs a Node class exposing the DOM node-type constants', async () => {
      delete (globalThis as any).Node;
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      const NodeCtor = (globalThis as any).Node;
      expect(NodeCtor).toBeTypeOf('function');
      expect(NodeCtor.COMMENT_NODE).toBe(8);
      expect(NodeCtor.TEXT_NODE).toBe(3);
      expect(NodeCtor.ELEMENT_NODE).toBe(1);
    });
  });

  describe('document', () => {
    it('installs a minimal document stub on the background thread', async () => {
      delete (globalThis as any).document;
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect((globalThis as any).document.defaultView).toBe(globalThis);
      expect((globalThis as any).document.querySelector('base')).toBe(null);
    });

    // The one elements' ownerDocument and DOCUMENT are (see global-events).
    it('is the document stand-in on the main thread', async () => {
      delete (globalThis as any).document;
      vi.stubGlobal('__MAIN_THREAD__', true);
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      const { globalEvents } = await import('./global-events');
      expect((globalThis as any).document).toBe(globalEvents().document);
      delete (globalThis as any).document;
    });
  });

  describe('window', () => {
    it('points window at globalThis', async () => {
      delete (globalThis as any).window;
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect((globalThis as any).window).toBe(globalThis);
    });

    /**
     * A `window` whose first assignment throws, as globalThis.window does in
     * the web preview's iframe. In the preview the second assignment sets
     * web-core's wrapper's `let window`; here, the global's setter.
     */
    const readOnlyWindow = () => {
      const set = vi.fn().mockImplementationOnce(() => {
        throw new TypeError(
          'Cannot set property window, which has only a getter',
        );
      });
      Object.defineProperty(globalThis, 'window', {
        get: () => undefined,
        set,
        configurable: true,
      });
      return set;
    };

    it("points the web wrapper's window at globalThis", async () => {
      vi.stubGlobal('__WEB__', true);
      vi.stubGlobal('lynx', undefined);
      const set = readOnlyWindow();
      await importFresh();
      expect(set).toHaveBeenCalledTimes(2);
      expect(set).toHaveBeenLastCalledWith(globalThis);
      delete (globalThis as any).window;
    });

    it('leaves a read-only window alone elsewhere', async () => {
      vi.stubGlobal('__WEB__', false);
      vi.stubGlobal('lynx', undefined);
      const set = readOnlyWindow();
      await importFresh();
      expect(set).toHaveBeenCalledTimes(1);
      delete (globalThis as any).window;
    });
  });

  describe('navigator', () => {
    it('installs a navigator with an empty userAgent', async () => {
      delete (globalThis as any).navigator;
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect((globalThis as any).navigator.userAgent).toBe('');
    });
  });

  describe('addEventListener/removeEventListener', () => {
    // window: listeners, and the screen's events (see global-events).
    it("are the window stand-in's on the main thread", async () => {
      vi.stubGlobal('__MAIN_THREAD__', true);
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      const { globalEvents } = await import('./global-events');
      const listener = (): void => {};
      globalThis.addEventListener('resize', listener);
      expect(globalEvents().window.hasListeners('resize')).toBe(true);
      globalThis.removeEventListener('resize', listener);
      expect(globalEvents().window.hasListeners('resize')).toBe(false);
    });

    it('installs no-op listener stubs', async () => {
      delete (globalThis as any).addEventListener;
      delete (globalThis as any).removeEventListener;
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect(globalThis.addEventListener).toBeTypeOf('function');
      expect(globalThis.removeEventListener).toBeTypeOf('function');
      const listener = (): void => {};
      expect(
        (globalThis as any).addEventListener('x', listener),
      ).toBeUndefined();
      expect(
        (globalThis as any).removeEventListener('x', listener),
      ).toBeUndefined();
    });
  });

  describe('timers', () => {
    it('maps timer/raf APIs from the lynx global when setTimeout is missing', async () => {
      const lynxTimers = {
        setTimeout: vi.fn(),
        setInterval: vi.fn(),
        clearTimeout: vi.fn(),
        clearInterval: vi.fn(),
        requestAnimationFrame: vi.fn(),
        cancelAnimationFrame: vi.fn(),
      };
      // Also clear requestIdleCallback so the block below reinstalls it cleanly.
      delete (globalThis as any).requestIdleCallback;
      delete (globalThis as any).cancelIdleCallback;
      // stubGlobal saves the real setTimeout and unstubAllGlobals restores it.
      vi.stubGlobal('setTimeout', undefined);
      vi.stubGlobal('lynx', lynxTimers);
      await importFresh();

      expect(globalThis.setTimeout).toBe(lynxTimers.setTimeout);
      expect(globalThis.setInterval).toBe(lynxTimers.setInterval);
      globalThis.clearTimeout(4 as unknown as ReturnType<typeof setTimeout>);
      globalThis.clearInterval(5 as unknown as ReturnType<typeof setInterval>);
      expect(lynxTimers.clearTimeout).toHaveBeenCalledWith(4);
      expect(lynxTimers.clearInterval).toHaveBeenCalledWith(5);
      expect((globalThis as any).requestAnimationFrame).toBe(
        lynxTimers.requestAnimationFrame,
      );
      (globalThis as any).cancelAnimationFrame(7);
      expect(lynxTimers.cancelAnimationFrame).toHaveBeenCalledWith(7);
    });

    it('ignores a cancelAnimationFrame handle that isn’t a number, as a browser does', async () => {
      // Lynx's own throws for one: three.js stops a loop that never started
      // with `null` each time a renderer is disposed.
      const cancel = vi.fn((handle: unknown) => {
        if (typeof handle !== 'number')
          throw new Error('param 0 should be Number');
      });
      vi.stubGlobal('cancelAnimationFrame', cancel);
      await importFresh();

      expect(() =>
        (globalThis as any).cancelAnimationFrame(null),
      ).not.toThrow();
      expect(() =>
        (globalThis as any).cancelAnimationFrame(undefined),
      ).not.toThrow();
      expect(cancel).not.toHaveBeenCalled();
      (globalThis as any).cancelAnimationFrame(3);
      expect(cancel).toHaveBeenCalledWith(3);
    });

    it('leaves cancelAnimationFrame out where there is none', async () => {
      vi.stubGlobal('cancelAnimationFrame', undefined);
      vi.stubGlobal('lynx', undefined);
      await importFresh();

      expect((globalThis as any).cancelAnimationFrame).toBeUndefined();
    });

    it('falls back to lynx.clearTimeInterval when clearInterval is absent', async () => {
      const lynxTimers = {
        setTimeout: vi.fn(),
        setInterval: vi.fn(),
        clearTimeout: vi.fn(),
        clearTimeInterval: vi.fn(),
      };
      vi.stubGlobal('setTimeout', undefined);
      vi.stubGlobal('lynx', lynxTimers);
      await importFresh();
      globalThis.clearInterval(6 as unknown as ReturnType<typeof setInterval>);
      expect(lynxTimers.clearTimeInterval).toHaveBeenCalledWith(6);
    });

    it('ignores clearing an undefined or null timer, as a browser does', async () => {
      /**
       * Lynx's own throw for one: a component clears a timer it may not have
       * started yet before starting one.
       */
      const strict = () =>
        vi.fn((handle: unknown) => {
          if (typeof handle !== 'number')
            throw new Error('ClearTimeout param 0 should be Number');
        });
      const clearTimeoutSpy = strict();
      const clearIntervalSpy = strict();
      vi.stubGlobal('clearTimeout', clearTimeoutSpy);
      vi.stubGlobal('clearInterval', clearIntervalSpy);
      vi.stubGlobal('lynx', undefined);
      await importFresh();

      for (const name of ['clearTimeout', 'clearInterval'] as const) {
        const clear = (globalThis as any)[name] as (handle?: unknown) => void;
        expect(() => clear(undefined)).not.toThrow();
        expect(() => clear(null)).not.toThrow();
        expect(() => clear()).not.toThrow();
      }
      expect(clearTimeoutSpy).not.toHaveBeenCalled();
      expect(clearIntervalSpy).not.toHaveBeenCalled();
      globalThis.clearTimeout(8 as unknown as ReturnType<typeof setTimeout>);
      globalThis.clearInterval(9 as unknown as ReturnType<typeof setInterval>);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(8);
      expect(clearIntervalSpy).toHaveBeenCalledWith(9);
    });

    it('leaves clearTimeout and clearInterval out where there are none', async () => {
      vi.stubGlobal('clearTimeout', undefined);
      vi.stubGlobal('clearInterval', undefined);
      vi.stubGlobal('setTimeout', () => 0);
      vi.stubGlobal('lynx', undefined);
      await importFresh();

      expect(globalThis.clearTimeout).toBeUndefined();
      expect(globalThis.clearInterval).toBeUndefined();
    });
  });

  describe('requestIdleCallback/cancelIdleCallback', () => {
    it('installs a matched pair that hands the callback an IdleDeadline', async () => {
      delete (globalThis as any).requestIdleCallback;
      delete (globalThis as any).cancelIdleCallback;
      // Run the scheduled callback synchronously so the deadline arrow executes.
      const setTimeoutSpy = vi.fn((cb: () => void) => {
        cb();
        return 123 as unknown as ReturnType<typeof setTimeout>;
      });
      const clearTimeoutSpy = vi.fn();
      vi.stubGlobal('setTimeout', setTimeoutSpy);
      vi.stubGlobal('clearTimeout', clearTimeoutSpy);
      vi.stubGlobal('lynx', undefined);
      await importFresh();

      let deadline: {
        didTimeout: boolean;
        timeRemaining: () => number;
      } | null = null;
      const id = (globalThis as any).requestIdleCallback(
        (d: { didTimeout: boolean; timeRemaining: () => number }) => {
          deadline = d;
        },
      );
      expect(deadline).not.toBeNull();
      expect(deadline!.didTimeout).toBe(false);
      expect(deadline!.timeRemaining()).toBe(50);

      (globalThis as any).cancelIdleCallback(id);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
    });
  });
});
