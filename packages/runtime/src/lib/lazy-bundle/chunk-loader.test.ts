import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryComponentResult = { code: number; detail: { schema: string } };
type QueryCallback = (result: QueryComponentResult) => void;
type LoadLazyBundle = (source: string, mode?: string) => Promise<unknown>;

/**
 * Re-imports the module and installs the loader onto a fresh `lynx` stub, so
 * each test observes the globals (`__MAIN_THREAD__`, `__DEV__`, `lynx`) it set
 * up. Mirrors the dynamic-import pattern in lazy-bundle.test.ts.
 */
const install = async (
  lynxStub: Record<string, unknown>,
): Promise<LoadLazyBundle> => {
  vi.stubGlobal('lynx', lynxStub);
  vi.resetModules();
  const { installLazyBundleLoader } = await import('./chunk-loader');
  installLazyBundleLoader();
  return lynxStub['loadLazyBundle'] as LoadLazyBundle;
};

/**
 * Builds a background-thread `lynx` stub whose QueryComponent invokes the
 * callback either synchronously (cached bundle) or later (network fetch).
 * The exports lookup is keyed by schema so tests can simulate a bundle whose
 * JS threw (code 0 but no exports).
 */
const makeBackgroundLynx = (opts: {
  code?: number;
  exports?: unknown;
  sync?: boolean;
  native?: boolean;
}) => {
  const {
    code = 0,
    exports = { default: 'Mod' },
    sync = true,
    native = false,
  } = opts;
  let pending: (() => void) | undefined;
  const queryComponent = vi.fn((source: string, callback: QueryCallback) => {
    const fire = () => callback({ code, detail: { schema: source } });
    if (sync) {
      fire();
    } else {
      pending = fire;
    }
  });
  const getDynamicComponentExports = vi.fn(() => exports);
  const stub: Record<string, unknown> = {
    getApp: () => ({ getDynamicComponentExports }),
    getNativeLynx: vi.fn(() => ({ QueryComponent: queryComponent })),
  };
  if (!native) {
    stub['QueryComponent'] = queryComponent;
  }
  return {
    stub,
    queryComponent,
    getDynamicComponentExports,
    flush: () => pending?.(),
  };
};

describe('installLazyBundleLoader', () => {
  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', false);
    vi.stubGlobal('__DEV__', false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('installs loadLazyBundle onto the lynx global', async () => {
    const stub: Record<string, unknown> = {};
    const load = await install(stub);
    expect(typeof load).toBe('function');
  });

  describe('main thread', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', true);
    });

    it('resolves with evalResult and runs `then` synchronously', async () => {
      const mod = { default: 'Main' };
      const queryComponent = vi.fn(() => ({ evalResult: mod }));
      vi.stubGlobal('__QueryComponent', queryComponent);
      const load = await install({});

      let seen: unknown;
      const promise = load('a.bundle');
      void promise.then((m) => {
        seen = m;
      });
      // Synchronous `then`: the value is available in the same tick.
      expect(seen).toBe(mod);
      expect(queryComponent).toHaveBeenCalledWith(
        'a.bundle',
        expect.any(Function),
      );
      // The no-op callback is part of the shared signature only.
      (queryComponent.mock.calls[0] as unknown[] as [string, () => void])[1]();
      await expect(promise).resolves.toBe(mod);
    });

    it('returns a never-settling promise when __QueryComponent throws', async () => {
      vi.stubGlobal(
        '__QueryComponent',
        vi.fn(() => {
          throw new Error('boom');
        }),
      );
      const load = await install({});

      const onSettled = vi.fn();
      load('a.bundle').then(onSettled, onSettled);
      await new Promise((r) => setTimeout(r, 0));
      expect(onSettled).not.toHaveBeenCalled();
    });

    it('ignores `mode` on the main thread even in __DEV__', async () => {
      vi.stubGlobal('__DEV__', true);
      vi.stubGlobal(
        '__QueryComponent',
        vi.fn(() => ({ evalResult: 1 })),
      );
      const load = await install({});
      await expect(load('a.bundle', 'sync')).resolves.toBe(1);
    });
  });

  describe('background thread', () => {
    it('uses lynx.QueryComponent and resolves synchronously when cached', async () => {
      const bg = makeBackgroundLynx({ exports: { default: 'Cached' } });
      const load = await install(bg.stub);

      let seen: unknown;
      void load('b.bundle').then((m) => {
        seen = m;
      });
      expect(seen).toEqual({ default: 'Cached' });
      expect(bg.queryComponent).toHaveBeenCalledWith(
        'b.bundle',
        expect.any(Function),
      );
      expect(bg.stub['getNativeLynx']).not.toHaveBeenCalled();
      expect(bg.getDynamicComponentExports).toHaveBeenCalledWith('b.bundle');
    });

    it('falls back to getNativeLynx().QueryComponent', async () => {
      const bg = makeBackgroundLynx({ native: true });
      const load = await install(bg.stub);

      await expect(load('c.bundle')).resolves.toEqual({ default: 'Mod' });
      expect(bg.stub['getNativeLynx']).toHaveBeenCalled();
      expect(bg.queryComponent).toHaveBeenCalledTimes(1);
    });

    it('rejects synchronously-reported failures (code != 0) with a cause', async () => {
      const bg = makeBackgroundLynx({ code: 1 });
      const load = await install(bg.stub);

      const error = await load('d.bundle').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        'Lazy bundle load failed, schema: d.bundle',
      );
      expect((error as Error & { cause: unknown }).cause).toBe(
        JSON.stringify({ code: 1, detail: { schema: 'd.bundle' } }),
      );
      expect(bg.getDynamicComponentExports).not.toHaveBeenCalled();
    });

    it('rejects when code is 0 but the bundle produced no exports', async () => {
      const bg = makeBackgroundLynx({ code: 0, exports: null });
      const load = await install(bg.stub);

      const error = await load('e.bundle').catch((e: unknown) => e);
      expect((error as Error).message).toBe(
        'Lazy bundle load failed, schema: e.bundle',
      );
      expect((error as Error & { cause: unknown }).cause).toBe(
        JSON.stringify({ code: 0, detail: { schema: 'e.bundle' } }),
      );
    });

    it('resolves when the callback fires asynchronously', async () => {
      const bg = makeBackgroundLynx({ sync: false });
      const load = await install(bg.stub);

      const promise = load('f.bundle');
      bg.flush();
      await expect(promise).resolves.toEqual({ default: 'Mod' });
    });

    it('rejects when the callback fires asynchronously with a failure', async () => {
      const bg = makeBackgroundLynx({ sync: false, code: 2 });
      const load = await install(bg.stub);

      const promise = load('g.bundle');
      bg.flush();
      const error = await promise.catch((e: unknown) => e);
      expect((error as Error).message).toBe(
        'Lazy bundle load failed, schema: g.bundle',
      );
      expect((error as Error & { cause: unknown }).cause).toBe(
        JSON.stringify({ code: 2, detail: { schema: 'g.bundle' } }),
      );
    });

    it('throws for an explicit `mode` in __DEV__', async () => {
      vi.stubGlobal('__DEV__', true);
      const bg = makeBackgroundLynx({});
      const load = await install(bg.stub);

      expect(() => load('h.bundle', 'sync')).toThrow(
        "Lazy bundle import `mode: 'sync'` requires FetchBundle, but the current build uses QueryComponent.",
      );
      expect(bg.queryComponent).not.toHaveBeenCalled();
    });

    it('allows no `mode` in __DEV__', async () => {
      vi.stubGlobal('__DEV__', true);
      const bg = makeBackgroundLynx({});
      const load = await install(bg.stub);
      await expect(load('i.bundle')).resolves.toEqual({ default: 'Mod' });
    });

    it('ignores `mode` when __DEV__ is false', async () => {
      const bg = makeBackgroundLynx({});
      const load = await install(bg.stub);
      await expect(load('j.bundle', 'async')).resolves.toEqual({
        default: 'Mod',
      });
    });
  });

  describe('synchronous then', () => {
    /**
     * A sync-resolved promise from the cached background path. It's wrapped in
     * an object because awaiting the promise itself would unwrap it.
     */
    const syncLoad = async (value: unknown) => {
      const bg = makeBackgroundLynx({ exports: value });
      const load = await install(bg.stub);
      return { promise: load('k.bundle') };
    };

    it('returns another sync-resolved promise when onFulfilled is omitted', async () => {
      const { promise } = await syncLoad({ v: 1 });
      const next = promise.then();
      expect(next).not.toBe(promise);

      let seen: unknown;
      void next.then((m) => {
        seen = m;
      });
      expect(seen).toEqual({ v: 1 });
      // `null` is treated the same as omitted.
      await expect(promise.then(null)).resolves.toEqual({ v: 1 });
    });

    it('returns a rejected promise when onFulfilled throws', async () => {
      const { promise } = await syncLoad({ v: 1 });
      const failure = new Error('handler failed');
      const next = promise.then(() => {
        throw failure;
      });
      await expect(next).rejects.toBe(failure);
    });

    it('returns a thenable from onFulfilled as-is', async () => {
      const { promise } = await syncLoad({ v: 1 });
      const inner = Promise.resolve('inner');
      const next = promise.then(() => inner);
      expect(next).toBe(inner);
      await expect(next).resolves.toBe('inner');
    });

    it('chains a plain value synchronously', async () => {
      const { promise } = await syncLoad({ v: 1 });
      let seen: unknown;
      void promise
        .then((m) => (m as { v: number }).v + 1)
        .then((n) => {
          seen = n;
        });
      expect(seen).toBe(2);
    });

    it('chains a falsy plain value synchronously', async () => {
      const { promise } = await syncLoad({ v: 1 });
      let seen: unknown = 'unset';
      void promise
        .then(() => 0)
        .then((n) => {
          seen = n;
        });
      expect(seen).toBe(0);
    });
  });
});
