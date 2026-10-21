import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as BridgeModule from './global-exposure-bridge';

/**
 * Fresh-imports the bridge with the given thread + lynx globals in place. It
 * installs itself at module load, so they must be stubbed before the import.
 */
const load = async (opts: {
  mainThread: boolean;
  lynx?: unknown;
}): Promise<typeof BridgeModule> => {
  vi.resetModules();
  vi.stubGlobal('__MAIN_THREAD__', opts.mainThread);
  vi.stubGlobal('lynx', opts.lynx);
  return import('./global-exposure-bridge');
};

const collect = (mod: typeof BridgeModule): unknown[] => {
  const batches: unknown[] = [];
  mod.globalExposureBatches.subscribe((b) => batches.push(b));
  return batches;
};

describe('global exposure bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when lynx is not defined', async () => {
    await expect(load({ mainThread: false })).resolves.toBeDefined();
  });

  describe('on the background thread', () => {
    const fakeLynx = () => {
      const listeners: Record<string, (...args: unknown[]) => void> = {};
      const dispatchEvent = vi.fn();
      return {
        listeners,
        dispatchEvent,
        lynx: {
          getJSModule: () => ({
            addListener: (name: string, fn: (...args: unknown[]) => void) =>
              (listeners[name] = fn),
          }),
          getCoreContext: () => ({ dispatchEvent }),
        },
      };
    };

    it('publishes each exposure and disexposure batch', async () => {
      const { listeners, lynx } = fakeLynx();
      const batches = collect(await load({ mainThread: false, lynx }));

      listeners['exposure']!([{ 'exposure-id': 'a' }]);
      listeners['disexposure']!([{ 'exposure-id': 'b' }]);

      expect(batches).toEqual([
        { type: 'exposure', events: [{ 'exposure-id': 'a' }] },
        { type: 'disexposure', events: [{ 'exposure-id': 'b' }] },
      ]);
    });

    it('forwards each batch to the main thread through the core context', async () => {
      const { listeners, dispatchEvent, lynx } = fakeLynx();
      await load({ mainThread: false, lynx });

      listeners['exposure']!([{ 'exposure-id': 'a' }]);

      expect(dispatchEvent).toHaveBeenCalledWith({
        type: 'AngularLynx.GlobalExposure',
        data: JSON.stringify({
          type: 'exposure',
          events: [{ 'exposure-id': 'a' }],
        }),
      });
    });

    it('still publishes locally when there is no core context', async () => {
      const { listeners, lynx } = fakeLynx();
      const batches = collect(
        await load({
          mainThread: false,
          lynx: { ...lynx, getCoreContext: undefined },
        }),
      );

      listeners['exposure']!([]);

      expect(batches).toHaveLength(1);
    });

    it('does nothing when GlobalEventEmitter has no addListener', async () => {
      await expect(
        load({ mainThread: false, lynx: { getJSModule: () => ({}) } }),
      ).resolves.toBeDefined();
    });

    it('does nothing when lynx has no getJSModule', async () => {
      await expect(
        load({ mainThread: false, lynx: {} }),
      ).resolves.toBeDefined();
    });
  });

  describe('on the main thread', () => {
    it('publishes the batches the background thread forwards', async () => {
      let listener: (event: { data: string }) => void = () => {};
      const addEventListener = vi.fn(
        (_type: string, fn: typeof listener) => (listener = fn),
      );
      const batches = collect(
        await load({
          mainThread: true,
          lynx: { getJSContext: () => ({ addEventListener }) },
        }),
      );

      listener({
        data: JSON.stringify({ type: 'exposure', events: [{ id: 'a' }] }),
      });

      expect(addEventListener).toHaveBeenCalledWith(
        'AngularLynx.GlobalExposure',
        expect.any(Function),
      );
      expect(batches).toEqual([{ type: 'exposure', events: [{ id: 'a' }] }]);
    });

    it('does nothing when lynx has no getJSContext', async () => {
      await expect(load({ mainThread: true, lynx: {} })).resolves.toBeDefined();
    });

    it('swallows a getJSContext that throws', async () => {
      await expect(
        load({
          mainThread: true,
          lynx: {
            getJSContext: () => {
              throw new Error('no context');
            },
          },
        }),
      ).resolves.toBeDefined();
    });
  });
});
