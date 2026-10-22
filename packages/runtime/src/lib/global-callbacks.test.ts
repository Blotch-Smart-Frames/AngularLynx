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
 * Sends a cross-thread call request to `listener` and returns the parsed
 * reply of type `replyType`, waiting for it when the function is async.
 */
const call = async (
  fake: ReturnType<typeof makeFakeJSContext>,
  request: string,
  replyType: string,
  wkltId: string,
  params: unknown[],
): Promise<Record<string, unknown>> => {
  fake.listeners[request]({
    data: JSON.stringify({
      worklet: { _wkltId: wkltId },
      params,
      resolveId: 9,
    }),
  });
  const reply = await vi.waitFor(() => {
    const event = fake.dispatched.find((e) => e.type === replyType);
    if (!event) throw new Error('no reply yet');
    return event;
  });
  return JSON.parse(reply.data);
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

    it('updatePage does not throw without a lynx global', () => {
      expect(() => (globalThis as any).updatePage({ a: 1 })).not.toThrow();
    });

    it('updateGlobalProps does not throw without a lynx global', () => {
      expect(() =>
        (globalThis as any).updateGlobalProps({ theme: 'Dark' }),
      ).not.toThrow();
    });

    it('processData returns the data unchanged by default', () => {
      // The engine passes this return value on to renderPage, so a default
      // that returned undefined would drop the InitData.
      const data = { userId: 'abc' };
      expect((globalThis as any).processData(data)).toBe(data);
    });
  });

  describe('InitData', () => {
    it('renderPage stores its data as lynx.__initData', async () => {
      const lynx: Record<string, unknown> = {};
      await load({ mainThread: true, lynx });

      (globalThis as any).renderPage({ userId: 'abc' });

      expect(lynx['__initData']).toEqual({ userId: 'abc' });
    });

    it('renderPage stores an empty object when it gets no data', async () => {
      const lynx: Record<string, unknown> = {};
      await load({ mainThread: true, lynx });

      (globalThis as any).renderPage();

      expect(lynx['__initData']).toEqual({});
    });

    it('renderPage stores the data before firing pageReady', async () => {
      const lynx: Record<string, unknown> = {};
      const mod = await load({ mainThread: true, lynx });
      let seen: unknown;
      mod.pageReady.subscribe(() => {
        seen = lynx['__initData'];
      });

      (globalThis as any).renderPage({ userId: 'abc' });

      expect(seen).toEqual({ userId: 'abc' });
    });

    it('seeds lynx.__initData from the loadCard params on the background thread', async () => {
      const lynx: Record<string, unknown> = {
        getApp: () => ({
          _params: {
            initData: { userId: 'abc', theme: 'light' },
            updateData: { theme: 'dark' },
          },
        }),
      };

      await load({ mainThread: false, lynx });

      // updateData arrived after initData, so its keys win.
      expect(lynx['__initData']).toEqual({ userId: 'abc', theme: 'dark' });
    });

    it('seeds an empty object when the app has no params', async () => {
      const lynx: Record<string, unknown> = {
        getApp: () => ({ _params: null }),
      };

      await load({ mainThread: false, lynx });

      expect(lynx['__initData']).toEqual({});
    });

    it('leaves lynx.__initData alone when lynx has no getApp', async () => {
      const lynx: Record<string, unknown> = { __initData: { userId: 'abc' } };

      await load({ mainThread: false, lynx });

      expect(lynx['__initData']).toEqual({ userId: 'abc' });
    });

    it('does not read the loadCard params on the main thread', async () => {
      const getApp = vi.fn();

      await load({ mainThread: true, lynx: { getApp } });

      expect(getApp).not.toHaveBeenCalled();
    });
  });

  describe('host updates on the main thread', () => {
    it('updatePage merges the update into lynx.__initData', async () => {
      const lynx: Record<string, unknown> = { __initData: { userId: 'abc' } };
      await load({ mainThread: true, lynx });

      (globalThis as any).updatePage({ theme: 'dark' });

      expect(lynx['__initData']).toEqual({ userId: 'abc', theme: 'dark' });
    });

    it('updatePage replaces lynx.__initData when the host resets it', async () => {
      const lynx: Record<string, unknown> = { __initData: { userId: 'abc' } };
      await load({ mainThread: true, lynx });

      (globalThis as any).updatePage(
        { theme: 'dark' },
        { resetPageData: true },
      );

      expect(lynx['__initData']).toEqual({ theme: 'dark' });
    });

    it('updatePage publishes the merged InitData', async () => {
      await load({ mainThread: true, lynx: {} });
      const { initDataUpdates } = await import('./data-flow/host-updates');
      const published: unknown[] = [];
      initDataUpdates.subscribe((d) => published.push(d));

      (globalThis as any).updatePage({ userId: 'abc' });

      expect(published).toEqual([{ userId: 'abc' }]);
    });

    it('updateGlobalProps merges the update into lynx.__globalProps', async () => {
      const lynx: Record<string, unknown> = {
        __globalProps: { theme: 'Light', appLocale: 'en-US' },
      };
      await load({ mainThread: true, lynx });

      (globalThis as any).updateGlobalProps({ theme: 'Dark' });

      expect(lynx['__globalProps']).toEqual({
        theme: 'Dark',
        appLocale: 'en-US',
      });
    });

    it('listens for __UpdateGlobalProps on the engine context, the only way web-core delivers it', async () => {
      let listener: (event: { data?: unknown[] }) => void = () => {};
      const addEventListener = vi.fn(
        (_type: string, fn: typeof listener) => (listener = fn),
      );
      const lynx: Record<string, unknown> = {
        getEngine: () => ({ addEventListener }),
      };
      await load({ mainThread: true, lynx });

      listener({ data: [{ theme: 'Dark' }] });

      expect(addEventListener).toHaveBeenCalledWith(
        '__UpdateGlobalProps',
        expect.any(Function),
      );
      expect(lynx['__globalProps']).toEqual({ theme: 'Dark' });
    });

    it('treats an __UpdateGlobalProps event without data as no change', async () => {
      let listener: (event: { data?: unknown[] }) => void = () => {};
      const lynx: Record<string, unknown> = {
        __globalProps: { theme: 'Light' },
        getEngine: () => ({
          addEventListener: (_type: string, fn: typeof listener) =>
            (listener = fn),
        }),
      };
      await load({ mainThread: true, lynx });

      listener({});

      expect(lynx['__globalProps']).toEqual({ theme: 'Light' });
    });

    it('does not listen on the engine context on the background thread', async () => {
      const getEngine = vi.fn();

      await load({ mainThread: false, lynx: { getEngine } });

      expect(getEngine).not.toHaveBeenCalled();
    });
  });

  describe('host updates on the background thread', () => {
    const loadBackground = async (lynx: Record<string, unknown> = {}) => {
      const app: Record<string, any> = { _params: { initData: {} } };
      const emit = vi.fn();
      Object.assign(lynx, {
        getApp: () => app,
        getJSModule: () => ({ emit }),
      });
      await load({ mainThread: false, lynx });
      return { app, emit, lynx };
    };

    it('updateCardData merges the update into lynx.__initData', async () => {
      const { app, lynx } = await loadBackground();
      lynx['__initData'] = { userId: 'abc' };

      app['updateCardData']({ theme: 'dark' });

      expect(lynx['__initData']).toEqual({ userId: 'abc', theme: 'dark' });
    });

    it('updateCardData replaces lynx.__initData on a reset', async () => {
      const { app, lynx } = await loadBackground();
      lynx['__initData'] = { userId: 'abc' };

      app['updateCardData']({ theme: 'dark' }, { type: 1 });

      expect(lynx['__initData']).toEqual({ theme: 'dark' });
    });

    it('updateCardData drops the performance timing flag', async () => {
      const { app, lynx } = await loadBackground();

      app['updateCardData']({ theme: 'dark', __lynx_timing_flag: 'x' });

      expect(lynx['__initData']).toEqual({ theme: 'dark' });
    });

    it('updateCardData emits onDataChanged with the update', async () => {
      const { app, emit } = await loadBackground();

      app['updateCardData']({ theme: 'dark' });

      expect(emit).toHaveBeenCalledWith('onDataChanged', [{ theme: 'dark' }]);
    });

    it('updateCardData treats a missing update as no change', async () => {
      const { app, lynx } = await loadBackground();
      lynx['__initData'] = { userId: 'abc' };

      app['updateCardData']();

      expect(lynx['__initData']).toEqual({ userId: 'abc' });
    });

    it('updateGlobalProps emits onGlobalPropsChanged with the merged props', async () => {
      const { app, emit, lynx } = await loadBackground({
        __globalProps: { appLocale: 'en-US' },
      });

      app['updateGlobalProps']({ theme: 'Dark' });

      expect(lynx['__globalProps']).toEqual({
        appLocale: 'en-US',
        theme: 'Dark',
      });
      expect(emit).toHaveBeenCalledWith('onGlobalPropsChanged', [
        { appLocale: 'en-US', theme: 'Dark' },
      ]);
    });

    it('applies updates when lynx has no GlobalEventEmitter', async () => {
      const app: Record<string, any> = { _params: null };
      const lynx: Record<string, unknown> = { getApp: () => app };
      await load({ mainThread: false, lynx });

      app['updateGlobalProps']({ theme: 'Dark' });

      expect(lynx['__globalProps']).toEqual({ theme: 'Dark' });
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

    it("hands a MainThreadRef the background thread passed to the worklet as the main thread's ref", async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: true, lynx: { getJSContext: () => fake.ctx } });
      const ref = { current: 'main-copy' };
      globalThis.__workletRefMap[3] = ref;
      const worklet = vi.fn();
      globalThis.registerWorklet('main-thread', 'uses-ref', worklet);

      await call(
        fake,
        'Lynx.Worklet.runWorkletCtx',
        'Lynx.Worklet.FunctionCallRet',
        'uses-ref',
        [{ _wvid: 3 }, { nested: { _wvid: 3 } }],
      );

      expect(worklet.mock.calls[0]![0]).toBe(ref);
      expect(worklet.mock.calls[0]![1].nested).toBe(ref);
    });

    it('awaits an async worklet and replies with its result', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: true, lynx: { getJSContext: () => fake.ctx } });
      globalThis.registerWorklet(
        'main-thread',
        'async-mt',
        async () => 'later',
      );

      expect(
        await call(
          fake,
          'Lynx.Worklet.runWorkletCtx',
          'Lynx.Worklet.FunctionCallRet',
          'async-mt',
          [],
        ),
      ).toEqual({ resolveId: 9, returnValue: 'later' });
    });

    it('replies with an error for a worklet this thread never registered', async () => {
      const fake = makeFakeJSContext();
      await load({ mainThread: true, lynx: { getJSContext: () => fake.ctx } });

      const reply = await call(
        fake,
        'Lynx.Worklet.runWorkletCtx',
        'Lynx.Worklet.FunctionCallRet',
        'missing',
        [],
      );

      expect(reply['error']).toContain(
        'Main-thread worklet not found: missing',
      );
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
    // Regression: the background thread hears the main thread on
    // getCoreContext(). Listening on getJSContext() (its own context) meant
    // native runOnBackground() requests from Angular event handlers, which run
    // on the main thread, never arrived.
    it('listens on getCoreContext, not getJSContext', async () => {
      const core = makeFakeJSContext();
      const js = makeFakeJSContext();
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => core.ctx, getJSContext: () => js.ctx },
      });

      expect(Object.keys(core.listeners).sort()).toEqual([
        'Lynx.Worklet.FunctionCallRet',
        'Lynx.Worklet.runOnBackground',
      ]);
      expect(js.listeners).toEqual({});
    });

    it('registers no listeners when lynx has no getCoreContext', async () => {
      await expect(
        load({ mainThread: false, lynx: {} }),
      ).resolves.toBeDefined();
    });

    it('resolves pending promises on FunctionCallRet', async () => {
      const fake = makeFakeJSContext();
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => fake.ctx },
      });

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
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => fake.ctx },
      });

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
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => fake.ctx },
      });
      expect(() =>
        fake.listeners['Lynx.Worklet.FunctionCallRet']({
          data: JSON.stringify({ resolveId: 111, returnValue: 'x' }),
        }),
      ).not.toThrow();
    });

    it('executes runOnBackground requests from the main thread and replies', async () => {
      const fake = makeFakeJSContext();
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => fake.ctx },
      });

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
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => fake.ctx },
      });

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

    // Regression: an async background function, such as one that awaits
    // fetch(), used to resolve to {} for the caller, and its rejection went
    // unhandled.
    it('awaits an async background function and replies with its result', async () => {
      const fake = makeFakeJSContext();
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => fake.ctx },
      });
      globalThis.registerWorklet('background', 'fetches', async (n: number) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { doubled: n * 2 };
      });

      expect(
        await call(
          fake,
          'Lynx.Worklet.runOnBackground',
          'Lynx.Worklet.BgFunctionCallRet',
          'fetches',
          [21],
        ),
      ).toEqual({ resolveId: 9, returnValue: { doubled: 42 } });
    });

    it("sends an async background function's rejection back as the error", async () => {
      const fake = makeFakeJSContext();
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => fake.ctx },
      });
      globalThis.registerWorklet('background', 'rejects', async () => {
        throw new Error('offline');
      });

      expect(
        await call(
          fake,
          'Lynx.Worklet.runOnBackground',
          'Lynx.Worklet.BgFunctionCallRet',
          'rejects',
          [],
        ),
      ).toEqual({ resolveId: 9, error: 'offline' });
    });

    it("hands a MainThreadRef the main thread passed to the function as the background thread's ref", async () => {
      const fake = makeFakeJSContext();
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => fake.ctx },
      });
      const ref = { current: 'bg-copy' };
      globalThis.__workletRefMap[4] = ref;
      const fn = vi.fn();
      globalThis.registerWorklet('background', 'bg-ref', fn);

      await call(
        fake,
        'Lynx.Worklet.runOnBackground',
        'Lynx.Worklet.BgFunctionCallRet',
        'bg-ref',
        [{ _wvid: 4 }, { elementRefptr: 1 }],
      );

      expect(fn.mock.calls[0]![0]).toBe(ref);
      // Element handles stay plain: MainThreadElement is main-thread only.
      expect(fn.mock.calls[0]![1]).toEqual({ elementRefptr: 1 });
    });

    it('replies with an error for a background function this thread never registered', async () => {
      const fake = makeFakeJSContext();
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => fake.ctx },
      });

      const reply = await call(
        fake,
        'Lynx.Worklet.runOnBackground',
        'Lynx.Worklet.BgFunctionCallRet',
        'missing-bg',
        [],
      );

      expect(reply['error']).toContain(
        'Background function not found: missing-bg',
      );
    });

    it('swallows a getCoreContext that throws during background listener setup', async () => {
      await expect(
        load({
          mainThread: false,
          lynx: {
            getCoreContext: () => {
              throw new Error('no ctx');
            },
          },
        }),
      ).resolves.toBeDefined();
    });
  });
});
