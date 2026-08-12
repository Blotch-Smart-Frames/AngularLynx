import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as GlobalCallbacksModule from './global-callbacks';

/**
 * Fake Lynx JSContext capturing registered listeners + dispatched events, so
 * the cross-thread RPC handlers can be driven directly.
 */
const makeFakeJSContext = () => {
  const listeners: Record<string, (event: { data: string }) => void> = {};
  const dispatched: Array<{ type: string; data: string }> = [];
  return {
    ctx: {
      addEventListener: (
        type: string,
        fn: (event: { data: string }) => void,
      ): void => {
        listeners[type] = fn;
      },
      dispatchEvent: (event: { type: string; data: string }): void => {
        dispatched.push(event);
      },
    },
    listeners,
    dispatched,
  };
};

/**
 * Fresh-import global-callbacks with the given thread + lynx globals in place.
 * __MAIN_THREAD__ and lynx are read at module-load time, so they must be stubbed
 * before the import runs.
 */
const load = async (opts: {
  mainThread: boolean;
  lynx?: unknown;
}): Promise<typeof GlobalCallbacksModule> => {
  vi.resetModules();
  vi.stubGlobal('__MAIN_THREAD__', opts.mainThread);
  vi.stubGlobal('lynx', opts.lynx);
  return import('./global-callbacks');
};

describe('global-callbacks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).runOnBackground;
    delete (globalThis as any).ssrEncode;
    delete (globalThis as any).ssrHydrate;
    delete (globalThis as any).__LYNX_IS_HYDRATING__;
    delete (globalThis as any).__LYNX_HYDRATE_PAGE__;
    delete (globalThis as any).__LYNX_HYDRATE_QUEUE__;
  });

  describe('lifecycle callbacks', () => {
    beforeEach(async () => {
      await load({ mainThread: false });
    });

    it('renderPage fires the pageReady subject', async () => {
      const mod = await import('./global-callbacks');
      let fired = false;
      mod.pageReady.subscribe(() => {
        fired = true;
      });
      (globalThis as any).renderPage();
      expect(fired).toBe(true);
    });

    it('updatePage is a no-op that does not throw', () => {
      expect(() => (globalThis as any).updatePage()).not.toThrow();
    });

    it('processData is a no-op that does not throw', () => {
      expect(() => (globalThis as any).processData()).not.toThrow();
    });
  });

  describe('worklet registration + invocation', () => {
    beforeEach(async () => {
      await load({ mainThread: false });
    });

    it('registerWorklet stores a fn that runWorklet can invoke by _wkltId', () => {
      const fn = vi.fn().mockReturnValue('result');
      globalThis.registerWorklet('type', 'my-id', fn);
      const result = (globalThis as any).runWorklet({ _wkltId: 'my-id' }, [
        'arg1',
      ]);
      expect(fn).toHaveBeenCalledWith('arg1');
      expect(result).toBe('result');
    });

    it('exposes __workletRefMap as the shared main-thread ref map', () => {
      expect(globalThis.__workletRefMap).toBeTypeOf('object');
    });

    it('runWorklet invokes a direct function (legacy path)', () => {
      const fn = vi.fn().mockReturnValue(42);
      const result = (globalThis as any).runWorklet(fn, ['a', 'b']);
      expect(fn).toHaveBeenCalledWith('a', 'b');
      expect(result).toBe(42);
    });

    it('runWorklet unwraps a { _fn } gesture handle', () => {
      const fn = vi.fn().mockReturnValue('gestured');
      const result = (globalThis as any).runWorklet({ _fn: fn }, ['evt']);
      expect(fn).toHaveBeenCalledWith('evt');
      expect(result).toBe('gestured');
    });

    it('runWorklet transforms params before calling a registered worklet', () => {
      const received: unknown[] = [];
      globalThis.registerWorklet('type', 'transform', (...args: unknown[]) => {
        received.push(...args);
      });
      const ref = { current: 'el' };
      globalThis.__workletRefMap[5] = ref;
      (globalThis as any).runWorklet({ _wkltId: 'transform' }, [{ _wvid: 5 }]);
      expect(received[0]).toBe(ref);
    });

    it('runWorklet does nothing when the _wkltId is not registered', () => {
      expect(() =>
        (globalThis as any).runWorklet({ _wkltId: 'missing' }, []),
      ).not.toThrow();
    });

    it('runWorklet returns undefined for a non-matching context object', () => {
      expect((globalThis as any).runWorklet({}, [])).toBeUndefined();
    });

    it('warns in dev mode when a worklet _wkltId is not registered', async () => {
      await load({ mainThread: false });
      vi.stubGlobal('__DEV__', true);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (globalThis as any).runWorklet({ _wkltId: 'ghost' }, []);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Worklet not found: ghost'),
      );
      warn.mockRestore();
    });
  });

  describe('SSR callback registration', () => {
    it('registers ssrEncode/ssrHydrate when __ENABLE_SSR__ is enabled', async () => {
      delete (globalThis as any).ssrEncode;
      delete (globalThis as any).ssrHydrate;
      vi.stubGlobal('__ENABLE_SSR__', true);
      await load({ mainThread: false });
      expect((globalThis as any).ssrEncode).toBeTypeOf('function');
      expect((globalThis as any).ssrHydrate).toBeTypeOf('function');
    });

    it('does not register SSR callbacks when __ENABLE_SSR__ is disabled', async () => {
      delete (globalThis as any).ssrEncode;
      delete (globalThis as any).ssrHydrate;
      vi.stubGlobal('__ENABLE_SSR__', false);
      await load({ mainThread: false });
      expect((globalThis as any).ssrEncode).toBeUndefined();
    });
  });

  describe('MTS bridge globals', () => {
    beforeEach(async () => {
      await load({ mainThread: false });
    });

    it('__lynxMtsNextResolveId returns increasing ids', () => {
      const a = globalThis.__lynxMtsNextResolveId();
      const b = globalThis.__lynxMtsNextResolveId();
      expect(b).toBe(a + 1);
    });

    it('__lynxMtsPendingResolvers is a shared object', () => {
      expect(globalThis.__lynxMtsPendingResolvers).toBeTypeOf('object');
    });

    it('__lynxRunMainThreadWorklet runs a registered worklet in-place', () => {
      const fn = vi.fn().mockReturnValue('ran');
      globalThis.registerWorklet('main-thread', 'direct', fn);
      const result = globalThis.__lynxRunMainThreadWorklet('direct', ['x']);
      expect(fn).toHaveBeenCalledWith('x');
      expect(result).toBe('ran');
    });

    it('__lynxRunMainThreadWorklet throws when the worklet is not found', () => {
      expect(() => globalThis.__lynxRunMainThreadWorklet('nope', [])).toThrow(
        /Main-thread worklet not found: nope/,
      );
    });
  });

  describe('main-thread cross-thread RPC', () => {
    it('registers listeners and answers runWorkletCtx requests', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: true, lynx: { getJSContext: () => fake.ctx } });

      const worklet = vi.fn().mockReturnValue('answer');
      globalThis.registerWorklet('main-thread', 'wc', worklet);

      fake.listeners['Lynx.Worklet.runWorkletCtx']({
        data: JSON.stringify({
          worklet: { _wkltId: 'wc' },
          params: ['p'],
          resolveId: 1,
        }),
      });

      expect(worklet).toHaveBeenCalledWith('p');
      const ret = fake.dispatched.find(
        (e) => e.type === 'Lynx.Worklet.FunctionCallRet',
      )!;
      expect(JSON.parse(ret.data)).toMatchObject({
        resolveId: 1,
        returnValue: 'answer',
      });
    });

    it('captures a thrown worklet error in the runWorkletCtx response', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: true, lynx: { getJSContext: () => fake.ctx } });

      globalThis.registerWorklet('main-thread', 'boom', () => {
        throw new Error('kaboom');
      });

      fake.listeners['Lynx.Worklet.runWorkletCtx']({
        data: JSON.stringify({
          worklet: { _wkltId: 'boom' },
          params: [],
          resolveId: 2,
        }),
      });

      const ret = fake.dispatched.find(
        (e) => e.type === 'Lynx.Worklet.FunctionCallRet',
      )!;
      expect(JSON.parse(ret.data).error).toContain('kaboom');
    });

    it('resolves a pending runOnBackground promise on BgFunctionCallRet', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: true, lynx: { getJSContext: () => fake.ctx } });

      const promise = (globalThis as any).runOnBackground(
        { _wkltId: 'bg' },
        'arg',
      );
      // The request was dispatched to the background thread.
      const req = fake.dispatched.find(
        (e) => e.type === 'Lynx.Worklet.runOnBackground',
      )!;
      const { resolveId } = JSON.parse(req.data);

      fake.listeners['Lynx.Worklet.BgFunctionCallRet']({
        data: JSON.stringify({ resolveId, returnValue: 'done' }),
      });

      await expect(promise).resolves.toBe('done');
    });

    it('rejects a pending runOnBackground promise when the response has an error', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: true, lynx: { getJSContext: () => fake.ctx } });

      const promise = (globalThis as any).runOnBackground({ _wkltId: 'bg' });
      const req = fake.dispatched.find(
        (e) => e.type === 'Lynx.Worklet.runOnBackground',
      )!;
      const { resolveId } = JSON.parse(req.data);

      fake.listeners['Lynx.Worklet.BgFunctionCallRet']({
        data: JSON.stringify({ resolveId, error: 'bg failed' }),
      });

      await expect(promise).rejects.toThrow('bg failed');
    });

    it('ignores a BgFunctionCallRet with no matching pending resolver', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: true, lynx: { getJSContext: () => fake.ctx } });
      expect(() =>
        fake.listeners['Lynx.Worklet.BgFunctionCallRet']({
          data: JSON.stringify({ resolveId: 999, returnValue: 'x' }),
        }),
      ).not.toThrow();
    });

    it('rejects runOnBackground when dispatchEvent throws', async () => {
      const throwingCtx = {
        addEventListener: () => {},
        dispatchEvent: () => {
          throw new Error('dispatch failed');
        },
      };
      await load({
        mainThread: true,
        lynx: { getJSContext: () => throwingCtx },
      });
      await expect(
        (globalThis as any).runOnBackground({ _wkltId: 'bg' }),
      ).rejects.toThrow('dispatch failed');
    });

    it('swallows a getJSContext that throws during listener setup', async () => {
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
      // runOnBackground is still registered even though listeners failed to bind.
      expect((globalThis as any).runOnBackground).toBeTypeOf('function');
    });

    it('registers no listeners when lynx has no getJSContext', async () => {
      await expect(load({ mainThread: true, lynx: {} })).resolves.toBeDefined();
    });
  });

  describe('background-thread cross-thread RPC', () => {
    it('resolves pending promises on FunctionCallRet', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: false, lynx: { getJSContext: () => fake.ctx } });

      const resolve = vi.fn();
      const reject = vi.fn();
      globalThis.__lynxMtsPendingResolvers[7] = { resolve, reject };

      fake.listeners['Lynx.Worklet.FunctionCallRet']({
        data: JSON.stringify({ resolveId: 7, returnValue: 'ok' }),
      });

      expect(resolve).toHaveBeenCalledWith('ok');
    });

    it('rejects pending promises on FunctionCallRet with an error', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: false, lynx: { getJSContext: () => fake.ctx } });

      const resolve = vi.fn();
      const reject = vi.fn();
      globalThis.__lynxMtsPendingResolvers[8] = { resolve, reject };

      fake.listeners['Lynx.Worklet.FunctionCallRet']({
        data: JSON.stringify({ resolveId: 8, error: 'nope' }),
      });

      expect(reject).toHaveBeenCalled();
    });

    it('ignores a FunctionCallRet with no matching resolver', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: false, lynx: { getJSContext: () => fake.ctx } });
      expect(() =>
        fake.listeners['Lynx.Worklet.FunctionCallRet']({
          data: JSON.stringify({ resolveId: 111, returnValue: 'x' }),
        }),
      ).not.toThrow();
    });

    it('executes runOnBackground requests from the main thread and replies', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: false, lynx: { getJSContext: () => fake.ctx } });

      const worklet = vi.fn().mockReturnValue('bg-result');
      globalThis.registerWorklet('background', 'bg-fn', worklet);

      fake.listeners['Lynx.Worklet.runOnBackground']({
        data: JSON.stringify({
          worklet: { _wkltId: 'bg-fn' },
          params: ['a'],
          resolveId: 3,
        }),
      });

      expect(worklet).toHaveBeenCalledWith('a');
      const ret = fake.dispatched.find(
        (e) => e.type === 'Lynx.Worklet.BgFunctionCallRet',
      )!;
      expect(JSON.parse(ret.data)).toMatchObject({
        resolveId: 3,
        returnValue: 'bg-result',
      });
    });

    it('captures a thrown worklet error in the runOnBackground reply', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: false, lynx: { getJSContext: () => fake.ctx } });

      globalThis.registerWorklet('background', 'bg-boom', () => {
        throw new Error('bg boom');
      });

      fake.listeners['Lynx.Worklet.runOnBackground']({
        data: JSON.stringify({
          worklet: { _wkltId: 'bg-boom' },
          params: [],
          resolveId: 4,
        }),
      });

      const ret = fake.dispatched.find(
        (e) => e.type === 'Lynx.Worklet.BgFunctionCallRet',
      )!;
      expect(JSON.parse(ret.data).error).toContain('bg boom');
    });

    it('swallows a getJSContext that throws during background listener setup', async () => {
      await expect(
        load({
          mainThread: false,
          lynx: {
            getJSContext: () => {
              throw new Error('no ctx');
            },
          },
        }),
      ).resolves.toBeDefined();
    });
  });
});
