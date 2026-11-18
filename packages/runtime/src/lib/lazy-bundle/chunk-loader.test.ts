import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FetchBundleResponse = { code: number; url: string } | null;
type LoadLazyBundle = (source: string) => Promise<unknown>;

const SOURCE = 'http://host/lazy-bundle/route.bundle';

/**
 * Re-imports the module and installs the loader onto a fresh `lynx` stub, so
 * each test observes the globals (`__MAIN_THREAD__`, `lynx`) it set up.
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
 * A `lynx` stub whose `fetchBundle()` handler answers at once (a bundle native
 * already has) or when the test calls `respond()` (one still downloading).
 */
const makeLynx = (opts: {
  response?: FetchBundleResponse;
  sync?: boolean;
  loadScript?: (section: string, options: { bundleName: string }) => unknown;
}) => {
  const {
    response = { code: 0, url: SOURCE },
    sync = true,
    loadScript = () => () => ({ ids: [1], modules: {} }),
  } = opts;
  let pending: (() => void) | undefined;
  const fetchBundle = vi.fn((_url: string, _options: object) => ({
    // lynx.fetchBundle()'s handler is thenable, which is what's under test.
    // oxlint-disable-next-line unicorn/no-thenable
    then: (callback: (r: FetchBundleResponse) => void) => {
      const fire = () => callback(response);
      if (sync) {
        fire();
      } else {
        pending = fire;
      }
    },
  }));
  const loadScriptMock = vi.fn(loadScript);
  const stub: Record<string, unknown> = {
    fetchBundle,
    loadScript: loadScriptMock,
  };
  return {
    stub,
    fetchBundle,
    loadScript: loadScriptMock,
    respond: () => pending?.(),
  };
};

/**
 * Settles the microtask queue, so a promise that would settle has.
 */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('installLazyBundleLoader', () => {
  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('installs loadLazyBundle onto the lynx global', async () => {
    const load = await install({});
    expect(typeof load).toBe('function');
  });

  it('rejects with what to upgrade when the engine has no fetchBundle', async () => {
    const load = await install({});
    await expect(load(SOURCE)).rejects.toThrow(
      `Lazy bundle ${SOURCE} can't load: lazy bundles need Lynx 3.9 or later (lynx.fetchBundle).`,
    );
  });

  describe('main thread', () => {
    it("calls the section's function with the bundle's entry and resolves with the chunk", async () => {
      const chunk = { ids: ['route'], modules: {} };
      const factory = vi.fn(() => chunk);
      const { stub, fetchBundle, loadScript } = makeLynx({
        response: { code: 0, url: 'resolved-url' },
        loadScript: () => factory,
      });
      const load = await install(stub);

      await expect(load(SOURCE)).resolves.toBe(chunk);
      expect(fetchBundle).toHaveBeenCalledWith(SOURCE, {});
      expect(loadScript).toHaveBeenCalledWith('main-thread', {
        bundleName: 'resolved-url',
      });
      expect(factory).toHaveBeenCalledWith(SOURCE);
    });

    it("resolves with the section's exports when they are the chunk itself (Lynx for Web)", async () => {
      const chunk = { ids: ['route'], modules: {} };
      const { stub } = makeLynx({ loadScript: () => chunk });
      const load = await install(stub);

      await expect(load(SOURCE)).resolves.toBe(chunk);
    });

    it('waits for a bundle that is still downloading', async () => {
      const { stub, loadScript, respond } = makeLynx({ sync: false });
      const load = await install(stub);
      const settled = vi.fn();

      void load(SOURCE).then(settled);
      await flushMicrotasks();
      expect(settled).not.toHaveBeenCalled();
      expect(loadScript).not.toHaveBeenCalled();

      respond();
      await flushMicrotasks();
      expect(settled).toHaveBeenCalledWith({ ids: [1], modules: {} });
    });

    it("adopts the bundle's CSS section", async () => {
      const styleSheet = { id: 'sheet' };
      const loadStyleSheet = vi.fn(() => styleSheet);
      const adoptStyleSheet = vi.fn();
      vi.stubGlobal('__LoadStyleSheet', loadStyleSheet);
      vi.stubGlobal('__AdoptStyleSheet', adoptStyleSheet);
      const { stub } = makeLynx({
        response: { code: 0, url: 'resolved-url' },
      });
      const load = await install(stub);

      await load(SOURCE);
      expect(loadStyleSheet).toHaveBeenCalledWith('CSS', 'resolved-url');
      expect(adoptStyleSheet).toHaveBeenCalledWith(styleSheet);
    });

    it('adopts nothing when the bundle has no CSS', async () => {
      const adoptStyleSheet = vi.fn();
      vi.stubGlobal('__LoadStyleSheet', () => null);
      vi.stubGlobal('__AdoptStyleSheet', adoptStyleSheet);
      const { stub } = makeLynx({});
      const load = await install(stub);

      await load(SOURCE);
      expect(adoptStyleSheet).not.toHaveBeenCalled();
    });

    it('adopts nothing when only one of the stylesheet globals exists', async () => {
      const loadStyleSheet = vi.fn(() => ({}));
      vi.stubGlobal('__LoadStyleSheet', loadStyleSheet);
      const { stub } = makeLynx({});
      const load = await install(stub);

      await expect(load(SOURCE)).resolves.toBeDefined();
      expect(loadStyleSheet).not.toHaveBeenCalled();
    });

    it('rejects with the response as the cause when the bundle failed to load', async () => {
      const response = { code: 4, url: SOURCE };
      const { stub, loadScript } = makeLynx({ response });
      const load = await install(stub);

      const error = await load(SOURCE).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        `Lazy bundle load failed, schema: ${SOURCE}`,
      );
      expect((error as Error & { cause?: unknown }).cause).toBe(
        JSON.stringify(response),
      );
      expect(loadScript).not.toHaveBeenCalled();
    });

    it('rejects when there is no response', async () => {
      const { stub } = makeLynx({ response: null });
      const load = await install(stub);

      await expect(load(SOURCE)).rejects.toThrow(
        `Lazy bundle load failed, schema: ${SOURCE}`,
      );
    });

    it("rejects with the error the bundle's code throws", async () => {
      const thrown = new Error('module threw');
      const { stub } = makeLynx({
        loadScript: () => () => {
          throw thrown;
        },
      });
      const load = await install(stub);

      await expect(load(SOURCE)).rejects.toBe(thrown);
    });

    it('wraps a thrown value that is not an Error', async () => {
      const { stub } = makeLynx({
        loadScript: () => {
          // A section that throws a string, as a script may.
          // oxlint-disable-next-line no-throw-literal
          throw 'section missing';
        },
      });
      const load = await install(stub);

      await expect(load(SOURCE)).rejects.toThrow('section missing');
    });
  });

  describe('background thread', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', false);
    });

    it("runs the background section with the bundle's entry set, and puts the old one back", async () => {
      const exports = { ids: ['bg'], modules: {} };
      const g = globalThis as { globDynamicComponentEntry?: string };
      g.globDynamicComponentEntry = '__Card__';
      let entryDuringLoad: string | undefined;
      const { stub, loadScript } = makeLynx({
        response: { code: 0, url: 'resolved-url' },
        loadScript: () => {
          entryDuringLoad = g.globDynamicComponentEntry;
          return exports;
        },
      });
      const load = await install(stub);

      await expect(load(SOURCE)).resolves.toBe(exports);
      expect(loadScript).toHaveBeenCalledWith('background', {
        bundleName: 'resolved-url',
      });
      expect(entryDuringLoad).toBe(SOURCE);
      expect(g.globDynamicComponentEntry).toBe('__Card__');
      delete g.globDynamicComponentEntry;
    });

    it('puts the old entry back when the section throws', async () => {
      const g = globalThis as { globDynamicComponentEntry?: string };
      const { stub } = makeLynx({
        loadScript: () => {
          throw new Error('no background section');
        },
      });
      const load = await install(stub);

      await expect(load(SOURCE)).rejects.toThrow('no background section');
      expect(g.globDynamicComponentEntry).toBeUndefined();
    });
  });
});
