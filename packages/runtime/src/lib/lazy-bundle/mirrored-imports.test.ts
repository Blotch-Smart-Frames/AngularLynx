import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as MirroredImportsModule from './mirrored-imports';

type Listener = (event: { data: string }) => unknown;

/**
 * A fake thread context that records listeners and dispatched events, so a test
 * can play the other thread.
 */
const fakeContext = () => {
  const listeners: Record<string, Listener> = {};
  const dispatched: Array<{ type: string; data: string }> = [];
  return {
    listeners,
    dispatched,
    context: {
      addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
      dispatchEvent: (event: { type: string; data: string }) =>
        dispatched.push(event),
    },
  };
};

/**
 * Fresh-imports the module with the given thread + lynx globals in place. It
 * installs its listeners at module load, so they must be stubbed first.
 */
const load = async (opts: {
  mainThread: boolean;
  lynx?: unknown;
}): Promise<typeof MirroredImportsModule> => {
  vi.resetModules();
  vi.stubGlobal('__MAIN_THREAD__', opts.mainThread);
  vi.stubGlobal('lynx', opts.lynx);
  return import('./mirrored-imports');
};

/**
 * The key lists the main thread has sent, in order.
 */
const sentMessages = (fake: ReturnType<typeof fakeContext>) =>
  fake.dispatched
    .filter((event) => event.type === 'AngularLynx.MirrorImports')
    .map((event) => JSON.parse(event.data));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mirrored imports', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('on the main thread', () => {
    it('announces itself with an empty, synced list when it starts', async () => {
      const js = fakeContext();
      await load({
        mainThread: true,
        lynx: { getJSContext: () => js.context },
      });

      expect(sentMessages(js)).toEqual([{ keys: [], synced: true }]);
    });

    it('runs the import and sends its key to the background thread', async () => {
      const js = fakeContext();
      const { ɵmirrorImport } = await load({
        mainThread: true,
        lynx: { getJSContext: () => js.context },
      });
      const module = { Page: class {} };

      const result = ɵmirrorImport('file:0', () => Promise.resolve(module));

      await expect(result).resolves.toBe(module);
      expect(sentMessages(js).at(-1)).toEqual({ keys: ['file:0'] });
    });

    it("returns the import's own promise, so a synchronous then stays synchronous", async () => {
      const { ɵmirrorImport } = await load({ mainThread: true });
      const promise = Promise.resolve('module');

      expect(ɵmirrorImport('file:0', () => promise)).toBe(promise);
    });

    it('sends each key once', async () => {
      const js = fakeContext();
      const { ɵmirrorImport } = await load({
        mainThread: true,
        lynx: { getJSContext: () => js.context },
      });

      await ɵmirrorImport('file:0', () => Promise.resolve());
      await ɵmirrorImport('file:0', () => Promise.resolve());

      expect(sentMessages(js)).toEqual([
        { keys: [], synced: true },
        { keys: ['file:0'] },
      ]);
    });

    it('answers a background thread that starts later with every key so far', async () => {
      const js = fakeContext();
      const { ɵmirrorImport } = await load({
        mainThread: true,
        lynx: { getJSContext: () => js.context },
      });
      await ɵmirrorImport('a:0', () => Promise.resolve());
      await ɵmirrorImport('b:0', () => Promise.resolve());

      js.listeners['AngularLynx.BackgroundReady']({ data: '' });

      expect(sentMessages(js).at(-1)).toEqual({
        keys: ['a:0', 'b:0'],
        synced: true,
      });
    });

    it('ignores a registration, which is for the background thread', async () => {
      const { ɵregisterMirroredImport } = await load({ mainThread: true });
      const load2 = vi.fn();

      ɵregisterMirroredImport('file:0', load2);

      expect(load2).not.toHaveBeenCalled();
    });

    it('still runs the import without a background thread to tell', async () => {
      const { ɵmirrorImport } = await load({ mainThread: true });

      await expect(
        ɵmirrorImport('file:0', () => Promise.resolve('module')),
      ).resolves.toBe('module');
    });
  });

  describe('on the background thread', () => {
    it('announces itself to the main thread when it starts', async () => {
      const core = fakeContext();
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => core.context },
      });

      expect(core.dispatched).toEqual([
        { type: 'AngularLynx.BackgroundReady', data: '' },
      ]);
    });

    it('runs the registered loader for each key the main thread sends', async () => {
      const core = fakeContext();
      const { ɵregisterMirroredImport, whenImportsMirrored } = await load({
        mainThread: false,
        lynx: { getCoreContext: () => core.context },
      });
      const loader = vi.fn(() => Promise.resolve());
      ɵregisterMirroredImport('file:0', loader);

      core.listeners['AngularLynx.MirrorImports']({
        data: JSON.stringify({ keys: ['file:0'], synced: true }),
      });
      await whenImportsMirrored();

      expect(loader).toHaveBeenCalledOnce();
    });

    it('loads each key once, even when the main thread sends it again', async () => {
      const core = fakeContext();
      const { ɵregisterMirroredImport, whenImportsMirrored } = await load({
        mainThread: false,
        lynx: { getCoreContext: () => core.context },
      });
      const loader = vi.fn(() => Promise.resolve());
      ɵregisterMirroredImport('file:0', loader);

      for (let i = 0; i < 2; i++) {
        core.listeners['AngularLynx.MirrorImports']({
          data: JSON.stringify({ keys: ['file:0'], synced: true }),
        });
      }
      await whenImportsMirrored();

      expect(loader).toHaveBeenCalledOnce();
    });

    // A chunk's own lazy imports register when the chunk has run, so a key
    // from inside it must wait for the chunk.
    it('loads one key at a time, in order', async () => {
      const core = fakeContext();
      const { ɵregisterMirroredImport, whenImportsMirrored } = await load({
        mainThread: false,
        lynx: { getCoreContext: () => core.context },
      });
      const inner = vi.fn(() => Promise.resolve());
      ɵregisterMirroredImport('outer:0', async () => {
        await flush();
        ɵregisterMirroredImport('inner:0', inner);
      });

      core.listeners['AngularLynx.MirrorImports']({
        data: JSON.stringify({ keys: ['outer:0', 'inner:0'], synced: true }),
      });
      await whenImportsMirrored();

      expect(inner).toHaveBeenCalledOnce();
    });

    it('carries on after a load fails', async () => {
      const core = fakeContext();
      const { ɵregisterMirroredImport, whenImportsMirrored } = await load({
        mainThread: false,
        lynx: { getCoreContext: () => core.context },
      });
      const next = vi.fn(() => Promise.resolve());
      ɵregisterMirroredImport('broken:0', () =>
        Promise.reject(new Error('offline')),
      );
      ɵregisterMirroredImport('next:0', next);

      core.listeners['AngularLynx.MirrorImports']({
        data: JSON.stringify({ keys: ['broken:0', 'next:0'], synced: true }),
      });
      await whenImportsMirrored();

      expect(next).toHaveBeenCalledOnce();
    });

    it('skips a key with no loader', async () => {
      const core = fakeContext();
      const { whenImportsMirrored } = await load({
        mainThread: false,
        lynx: { getCoreContext: () => core.context },
      });

      core.listeners['AngularLynx.MirrorImports']({
        data: JSON.stringify({ keys: ['unknown:0'], synced: true }),
      });

      await expect(whenImportsMirrored()).resolves.toBeUndefined();
    });

    it("waits for the main thread's list before settling", async () => {
      const core = fakeContext();
      const { whenImportsMirrored } = await load({
        mainThread: false,
        lynx: { getCoreContext: () => core.context },
      });
      const settled = vi.fn();
      void whenImportsMirrored().then(settled);

      core.listeners['AngularLynx.MirrorImports']({
        data: JSON.stringify({ keys: [] }),
      });
      await flush();
      expect(settled).not.toHaveBeenCalled();

      core.listeners['AngularLynx.MirrorImports']({
        data: JSON.stringify({ keys: [], synced: true }),
      });
      await flush();
      expect(settled).toHaveBeenCalled();
    });

    it('runs an import in place when the build calls it', async () => {
      const { ɵmirrorImport } = await load({ mainThread: false });

      await expect(
        ɵmirrorImport('file:0', () => Promise.resolve('module')),
      ).resolves.toBe('module');
    });
  });

  it('installs nothing when lynx is not defined', async () => {
    await expect(load({ mainThread: false })).resolves.toBeDefined();
  });

  it('installs nothing when the thread context throws', async () => {
    await expect(
      load({
        mainThread: false,
        lynx: {
          getCoreContext: () => {
            throw new Error('no context');
          },
        },
      }),
    ).resolves.toBeDefined();
  });
});
