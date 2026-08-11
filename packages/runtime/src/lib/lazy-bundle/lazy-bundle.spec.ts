import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { loadLazyBundle as LoadLazyBundleFn } from './lazy-bundle';

/**
 * Dynamic import so the module picks up stubbed globals on each test.
 */
let loadLazyBundle: typeof LoadLazyBundleFn;

class FakeComponent {}

const makeMockQueryComponent = (
  opts: {
    sync?: boolean;
    code?: number;
    exports?: Record<string, unknown>;
    throwOnEval?: boolean;
    throwOnCall?: boolean;
  } = {},
) => {
  const {
    sync = true,
    code = 0,
    exports = { default: FakeComponent },
    throwOnEval = false,
    throwOnCall = false,
  } = opts;

  return vi.fn(
    (
      source: string,
      callback: (result: {
        code: number;
        data: { evalResult: (url: string) => unknown };
      }) => void,
    ) => {
      if (throwOnCall) {
        throw new Error('native crash');
      }

      const result = {
        code,
        data: {
          evalResult: (_url: string) => {
            if (throwOnEval) {
              throw new Error('eval error');
            }
            return exports;
          },
        },
      };

      if (sync) {
        callback(result);
      } else {
        setTimeout(() => callback(result), 0);
      }

      return { evalResult: exports };
    },
  );
};

describe('loadLazyBundle', () => {
  beforeEach(async () => {
    vi.stubGlobal('__MAIN_THREAD__', false);
    vi.stubGlobal('_ReportError', vi.fn());

    // Re-import to get a fresh module with a fresh cache.
    vi.resetModules();
    const mod = await import('./lazy-bundle');
    loadLazyBundle = mod.loadLazyBundle;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('background thread', () => {
    it('resolves with the default export on success', async () => {
      vi.stubGlobal(
        '__QueryComponent',
        makeMockQueryComponent({ exports: { default: FakeComponent } }),
      );

      const result = await loadLazyBundle('./my-bundle');

      expect(result).toBe(FakeComponent);
    });

    it('resolves with the exports object when there is no default', async () => {
      const exports = { MyComp: FakeComponent };
      vi.stubGlobal('__QueryComponent', makeMockQueryComponent({ exports }));

      const result = await loadLazyBundle('./my-bundle');

      expect(result).toBe(exports);
    });

    it('rejects when __QueryComponent returns a non-zero code', async () => {
      vi.stubGlobal('__QueryComponent', makeMockQueryComponent({ code: 1 }));

      await expect(loadLazyBundle('./bad-bundle')).rejects.toThrow(
        'Failed to load bundle "./bad-bundle" (code: 1)',
      );
    });

    it('rejects when evalResult throws', async () => {
      vi.stubGlobal(
        '__QueryComponent',
        makeMockQueryComponent({ throwOnEval: true }),
      );

      await expect(loadLazyBundle('./broken-bundle')).rejects.toThrow(
        'Failed to evaluate bundle "./broken-bundle"',
      );
    });

    it('handles async callback', async () => {
      vi.stubGlobal(
        '__QueryComponent',
        makeMockQueryComponent({ sync: false }),
      );

      vi.useFakeTimers();
      const promise = loadLazyBundle('./async-bundle');
      vi.runAllTimers();
      vi.useRealTimers();

      const result = await promise;
      expect(result).toBe(FakeComponent);
    });

    it('caches results for the same source', async () => {
      const mock = makeMockQueryComponent();
      vi.stubGlobal('__QueryComponent', mock);

      const first = loadLazyBundle('./cached');
      const second = loadLazyBundle('./cached');

      expect(first).toBe(second);
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it('does not share cache across different sources', async () => {
      const mock = makeMockQueryComponent();
      vi.stubGlobal('__QueryComponent', mock);

      const first = loadLazyBundle('./bundle-a');
      const second = loadLazyBundle('./bundle-b');

      expect(first).not.toBe(second);
      expect(mock).toHaveBeenCalledTimes(2);
    });

    it('reports errors via _ReportError', async () => {
      vi.stubGlobal('__QueryComponent', makeMockQueryComponent({ code: 1 }));

      try {
        await loadLazyBundle('./error-bundle');
      } catch {
        // expected
      }

      expect(_ReportError).toHaveBeenCalledWith(expect.any(Error), {
        errorCode: 6,
      });
    });
  });

  describe('main thread', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', true);
    });

    it('resolves synchronously with the default export', async () => {
      vi.stubGlobal(
        '__QueryComponent',
        makeMockQueryComponent({ exports: { default: FakeComponent } }),
      );

      const result = await loadLazyBundle('./main-bundle');

      expect(result).toBe(FakeComponent);
    });

    it('returns a never-resolving promise on error', async () => {
      vi.stubGlobal(
        '__QueryComponent',
        makeMockQueryComponent({ throwOnCall: true }),
      );

      const promise = loadLazyBundle('./crash-bundle');

      // Verify the promise is pending (not resolved or rejected).
      const resolved = await Promise.race([
        promise.then(() => 'resolved').catch(() => 'rejected'),
        new Promise<string>((r) => setTimeout(() => r('pending'), 10)),
      ]);

      expect(resolved).toBe('pending');
    });
  });

  describe('missing __QueryComponent', () => {
    it('rejects when __QueryComponent is not defined', async () => {
      vi.stubGlobal('__QueryComponent', undefined);

      await expect(loadLazyBundle('./missing')).rejects.toThrow(
        '__QueryComponent is not available',
      );
    });
  });
});
