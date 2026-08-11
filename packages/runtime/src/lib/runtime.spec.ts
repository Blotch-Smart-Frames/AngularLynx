import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { bootstrapApplication as BootstrapApplicationFn } from './runtime';

/**
 * vi.hoisted creates the mock function before any imports run, so the same
 * reference survives vi.resetModules() calls in beforeEach.
 */
const { mockNgBootstrap } = vi.hoisted(() => ({
  mockNgBootstrap: vi.fn(),
}));

vi.mock('@angular/platform-browser', () => ({
  bootstrapApplication: mockNgBootstrap,
}));

describe('runtime', () => {
  let bootstrapApplication: typeof BootstrapApplicationFn;
  let mockAppRef: { destroy: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockAppRef = { destroy: vi.fn() };
    mockNgBootstrap.mockReset();
    mockNgBootstrap.mockResolvedValue(mockAppRef);

    // __MAIN_THREAD__ must be set before the module runs so module-level
    // if (__MAIN_THREAD__) blocks are evaluated with a defined value.
    vi.stubGlobal('__MAIN_THREAD__', false);

    delete (globalThis as any).__LYNX_ANGULAR_APP_REF__;
    delete (globalThis as any).__lynxLastError;

    // Re-import to get a fresh module with a fresh pageReady Subject and
    // empty worklet map. Pattern mirrors lazy-bundle.spec.ts.
    vi.resetModules();
    const mod = await import('./runtime');
    bootstrapApplication = mod.bootstrapApplication;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).__LYNX_ANGULAR_APP_REF__;
    delete (globalThis as any).__lynxLastError;
  });

  describe('onerror handler', () => {
    it('sets __lynxLastError from the Error object', () => {
      const err = new Error('boom');
      (globalThis as any).onerror('boom', '', 0, 0, err);
      expect((globalThis as any).__lynxLastError).toContain('Error: boom');
    });

    it('constructs an Error from the message string when no Error object is provided', () => {
      (globalThis as any).onerror('bare message', '', 0, 0, undefined);
      expect((globalThis as any).__lynxLastError).toContain('bare message');
    });

    it('calls _ReportError with the error and errorCode 1101 when defined', () => {
      const mockReport = vi.fn();
      vi.stubGlobal('_ReportError', mockReport);
      const err = new Error('report me');
      (globalThis as any).onerror('report me', '', 0, 0, err);
      expect(mockReport).toHaveBeenCalledWith(err, { errorCode: 1101 });
    });

    it('does not throw when _ReportError is not defined', () => {
      delete (globalThis as any)._ReportError;
      const err = new Error('no reporter');
      expect(() =>
        (globalThis as any).onerror('no reporter', '', 0, 0, err),
      ).not.toThrow();
    });
  });

  describe('onunhandledrejection handler', () => {
    it('sets __lynxLastError when the rejection reason is an Error', () => {
      const err = new Error('rejected');
      (globalThis as any).onunhandledrejection({ reason: err });
      expect((globalThis as any).__lynxLastError).toContain('Error: rejected');
    });

    it('wraps non-Error rejection reasons in an Error with a descriptive message', () => {
      (globalThis as any).onunhandledrejection({ reason: 'string reason' });
      expect((globalThis as any).__lynxLastError).toContain(
        'Unhandled rejection: string reason',
      );
    });

    it('wraps numeric rejection reasons', () => {
      (globalThis as any).onunhandledrejection({ reason: 42 });
      expect((globalThis as any).__lynxLastError).toContain(
        'Unhandled rejection: 42',
      );
    });
  });

  describe('registerWorklet', () => {
    it('stores a function by ID so runWorklet can invoke it', () => {
      const fn = vi.fn().mockReturnValue('result');
      globalThis.registerWorklet('type', 'my-id', fn);
      const result = (globalThis as any).runWorklet({ _wkltId: 'my-id' }, [
        'arg1',
      ]);
      expect(fn).toHaveBeenCalledWith('arg1');
      expect(result).toBe('result');
    });

    it('overwrites a previously registered worklet with the same ID', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      globalThis.registerWorklet('type', 'dup-id', fn1);
      globalThis.registerWorklet('type', 'dup-id', fn2);
      (globalThis as any).runWorklet({ _wkltId: 'dup-id' }, []);
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalled();
    });
  });

  describe('runWorklet', () => {
    it('invokes a direct function (legacy path) with spread params', () => {
      const fn = vi.fn().mockReturnValue(42);
      const result = (globalThis as any).runWorklet(fn, ['a', 'b']);
      expect(fn).toHaveBeenCalledWith('a', 'b');
      expect(result).toBe(42);
    });

    it('invokes a worklet registered by _wkltId', () => {
      const fn = vi.fn().mockReturnValue('ok');
      globalThis.registerWorklet('type', 'wk', fn);
      const result = (globalThis as any).runWorklet({ _wkltId: 'wk' }, ['x']);
      expect(fn).toHaveBeenCalledWith('x');
      expect(result).toBe('ok');
    });

    it('invokes a direct main-thread function handle ({ _fn }) used by gestures', () => {
      // Fiber-arch gesture callbacks are wrapped as { _fn } objects so they land
      // in the native lepus_object_ slot; runWorklet must unwrap and call _fn.
      const fn = vi.fn().mockReturnValue('gestured');
      const result = (globalThis as any).runWorklet({ _fn: fn }, [
        'evt',
        'mgr',
      ]);
      expect(fn).toHaveBeenCalledWith('evt', 'mgr');
      expect(result).toBe('gestured');
    });

    it('does nothing when the _wkltId is not registered', () => {
      expect(() =>
        (globalThis as any).runWorklet({ _wkltId: 'missing' }, []),
      ).not.toThrow();
    });
  });

  describe('transformParams (exercised through runWorklet)', () => {
    /**
     * Helper: register a worklet that captures its first argument
     */
    const captureFirst = (id: string): { received: unknown[] } => {
      const received: unknown[] = [];
      globalThis.registerWorklet('type', id, (...args: unknown[]) => {
        received.push(...args);
      });
      return { received };
    };

    it('passes primitive params through unchanged', () => {
      const { received } = captureFirst('cap-prim');
      (globalThis as any).runWorklet({ _wkltId: 'cap-prim' }, [
        42,
        'hello',
        true,
        null,
      ]);
      expect(received).toEqual([42, 'hello', true, null]);
    });

    it('replaces elementRefptr objects with MainThreadElement wrappers', () => {
      const fakeRef = { nativeId: 1 };
      const { received } = captureFirst('cap-elem');
      (globalThis as any).runWorklet({ _wkltId: 'cap-elem' }, [
        { elementRefptr: fakeRef },
      ]);
      // The raw { elementRefptr } object should not be passed through
      expect(received[0]).not.toEqual({ elementRefptr: fakeRef });
      expect((received[0] as any).elementRefptr).toBeUndefined();
    });

    it('resolves _wvid entries from __workletRefMap', () => {
      const ref = { current: 'native-el' };
      (globalThis as any).__workletRefMap[99] = ref;
      const { received } = captureFirst('cap-vwid');
      (globalThis as any).runWorklet({ _wkltId: 'cap-vwid' }, [{ _wvid: 99 }]);
      expect(received[0]).toBe(ref);
    });

    it('leaves the raw object when _wvid is absent from the refMap', () => {
      const { received } = captureFirst('cap-missing-vwid');
      (globalThis as any).runWorklet({ _wkltId: 'cap-missing-vwid' }, [
        { _wvid: 999 },
      ]);
      expect(received[0]).toEqual({ _wvid: 999 });
    });

    it('maps array elements recursively', () => {
      const { received } = captureFirst('cap-arr');
      (globalThis as any).runWorklet({ _wkltId: 'cap-arr' }, [
        [1, 'two', true],
      ]);
      expect(received[0]).toEqual([1, 'two', true]);
    });

    it('recursively transforms nested plain objects', () => {
      const ref = { current: 'deep' };
      (globalThis as any).__workletRefMap[77] = ref;
      const { received } = captureFirst('cap-nested');
      (globalThis as any).runWorklet({ _wkltId: 'cap-nested' }, [
        { nested: { _wvid: 77 } },
      ]);
      expect((received[0] as any).nested).toBe(ref);
    });
  });

  describe('bootstrapApplication', () => {
    it('calls ngBootstrapApplication with the root component and config', async () => {
      class App {}
      const config = { providers: [] };
      await bootstrapApplication(App, config as any);
      expect(mockNgBootstrap).toHaveBeenCalledWith(App, config);
    });

    it('returns the ApplicationRef', async () => {
      class App {}
      const result = await bootstrapApplication(App);
      expect(result).toBe(mockAppRef);
    });

    it('stores the ApplicationRef on globalThis.__LYNX_ANGULAR_APP_REF__', async () => {
      class App {}
      await bootstrapApplication(App);
      expect((globalThis as any).__LYNX_ANGULAR_APP_REF__).toBe(mockAppRef);
    });

    describe('on the background thread (__MAIN_THREAD__ = false)', () => {
      it('bootstraps immediately without waiting for renderPage', async () => {
        class App {}
        // __MAIN_THREAD__ is already false from beforeEach
        await bootstrapApplication(App);
        expect(mockNgBootstrap).toHaveBeenCalled();
      });
    });

    describe('on the main thread (__MAIN_THREAD__ = true)', () => {
      it('waits for the renderPage callback before bootstrapping', async () => {
        vi.stubGlobal('__MAIN_THREAD__', true);
        class App {}

        let resolved = false;
        const promise = bootstrapApplication(App).then(() => {
          resolved = true;
        });

        // Yield to the microtask queue — the async function should be suspended
        // at firstValueFrom(pageReady), so ngBootstrapApplication should not yet run.
        await Promise.resolve();
        expect(mockNgBootstrap).not.toHaveBeenCalled();
        expect(resolved).toBe(false);

        // Simulate the Lynx engine calling renderPage to signal readiness
        (globalThis as any).renderPage();

        await promise;
        expect(resolved).toBe(true);
        expect(mockNgBootstrap).toHaveBeenCalled();
      });
    });

    describe('HMR re-bootstrap', () => {
      it('destroys the previous ApplicationRef before bootstrapping the new one', async () => {
        const prevAppRef = { destroy: vi.fn() };
        (globalThis as any).__LYNX_ANGULAR_APP_REF__ = prevAppRef;

        class App {}
        await bootstrapApplication(App);

        expect(prevAppRef.destroy).toHaveBeenCalled();
        expect((globalThis as any).__LYNX_ANGULAR_APP_REF__).toBe(mockAppRef);
      });

      it('clears the worklet map so stale worklets are not invoked after reload', async () => {
        const staleFn = vi.fn();
        globalThis.registerWorklet('type', 'stale-worklet', staleFn);

        (globalThis as any).__LYNX_ANGULAR_APP_REF__ = { destroy: vi.fn() };

        class App {}
        await bootstrapApplication(App);

        (globalThis as any).runWorklet({ _wkltId: 'stale-worklet' }, []);
        expect(staleFn).not.toHaveBeenCalled();
      });

      it('does not wait for renderPage even on the main thread', async () => {
        vi.stubGlobal('__MAIN_THREAD__', true);
        (globalThis as any).__LYNX_ANGULAR_APP_REF__ = { destroy: vi.fn() };

        class App {}
        // Should resolve without renderPage since prev is set
        await bootstrapApplication(App);

        expect(mockNgBootstrap).toHaveBeenCalled();
      });
    });
  });
});
