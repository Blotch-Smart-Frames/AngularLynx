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
      signal.removeEventListener('other', () => {});

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
    it('installs a minimal document stub', async () => {
      delete (globalThis as any).document;
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect((globalThis as any).document.defaultView).toBe(globalThis);
      expect((globalThis as any).document.querySelector('base')).toBe(null);
    });
  });

  describe('window', () => {
    it('points window at globalThis', async () => {
      delete (globalThis as any).window;
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect((globalThis as any).window).toBe(globalThis);
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
    it('installs no-op listener stubs', async () => {
      delete (globalThis as any).addEventListener;
      delete (globalThis as any).removeEventListener;
      vi.stubGlobal('lynx', undefined);
      await importFresh();
      expect(globalThis.addEventListener).toBeTypeOf('function');
      expect(globalThis.removeEventListener).toBeTypeOf('function');
      expect(
        (globalThis as any).addEventListener('x', () => {}),
      ).toBeUndefined();
      expect(
        (globalThis as any).removeEventListener('x', () => {}),
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
      expect(globalThis.clearTimeout).toBe(lynxTimers.clearTimeout);
      expect(globalThis.clearInterval).toBe(lynxTimers.clearInterval);
      expect((globalThis as any).requestAnimationFrame).toBe(
        lynxTimers.requestAnimationFrame,
      );
      expect((globalThis as any).cancelAnimationFrame).toBe(
        lynxTimers.cancelAnimationFrame,
      );
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
      expect(globalThis.clearInterval).toBe(lynxTimers.clearTimeInterval);
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

      let deadline: { didTimeout: boolean; timeRemaining: () => number } | null =
        null;
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
