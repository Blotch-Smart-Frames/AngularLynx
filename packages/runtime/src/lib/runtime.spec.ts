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

describe('runtime bootstrapApplication', () => {
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

  describe('SSR + web define-gated behavior', () => {
    afterEach(() => {
      vi.useRealTimers();
      delete (globalThis as any).__LYNX_IS_HYDRATING__;
      delete (globalThis as any).__LYNX_HYDRATE_PAGE__;
      delete (globalThis as any).__LYNX_HYDRATE_QUEUE__;
    });

    it('clears hydration state after bootstrap when SSR hydration was active', async () => {
      vi.stubGlobal('__ENABLE_SSR__', true);
      (globalThis as any).__LYNX_IS_HYDRATING__ = true;
      (globalThis as any).__LYNX_HYDRATE_PAGE__ = { p: 1 };
      (globalThis as any).__LYNX_HYDRATE_QUEUE__ = [1, 2];

      class App {}
      await bootstrapApplication(App);

      expect((globalThis as any).__LYNX_IS_HYDRATING__).toBe(false);
      expect((globalThis as any).__LYNX_HYDRATE_PAGE__).toBeUndefined();
      expect((globalThis as any).__LYNX_HYDRATE_QUEUE__).toBeUndefined();
    });

    it('forces the first element-tree flush on web after a non-hydrating bootstrap', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('__WEB__', true);
      vi.stubGlobal('__MAIN_THREAD__', true);
      vi.stubGlobal('__ENABLE_SSR__', false);
      const flush = vi.fn();
      vi.stubGlobal('__FlushElementTree', flush);

      // Set a prev appRef so bootstrap skips the main-thread renderPage wait.
      (globalThis as any).__LYNX_ANGULAR_APP_REF__ = { destroy: vi.fn() };

      class App {}
      await bootstrapApplication(App);
      vi.runAllTimers();

      expect(flush).toHaveBeenCalled();
    });
  });
});
