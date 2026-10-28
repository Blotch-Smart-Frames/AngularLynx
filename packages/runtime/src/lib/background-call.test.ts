import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as BackgroundCallModule from './background-call';

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
  mainThread?: boolean;
  lynx?: unknown;
}): Promise<typeof BackgroundCallModule> => {
  vi.resetModules();
  if (opts.mainThread !== undefined) {
    vi.stubGlobal('__MAIN_THREAD__', opts.mainThread);
  }
  vi.stubGlobal('lynx', opts.lynx);
  return import('./background-call');
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('callOnBackground()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('on the background thread', () => {
    it('runs accessibilityAnnounce directly and resolves when Lynx is done', async () => {
      const accessibilityAnnounce = vi.fn((_opts, done: () => void) => done());
      const { callOnBackground } = await load({
        mainThread: false,
        lynx: { accessibilityAnnounce },
      });

      await callOnBackground('accessibilityAnnounce', 'Saved');

      expect(accessibilityAnnounce).toHaveBeenCalledWith(
        { content: 'Saved' },
        expect.any(Function),
      );
    });

    it('treats a missing __MAIN_THREAD__ as the background thread', async () => {
      const setObserverFrameRate = vi.fn();
      const { callOnBackground } = await load({
        lynx: { setObserverFrameRate },
      });

      await callOnBackground('setObserverFrameRate', { forPageRect: 10 });

      expect(setObserverFrameRate).toHaveBeenCalledWith({ forPageRect: 10 });
    });

    it('rejects with a clear error when the API is missing', async () => {
      const { callOnBackground } = await load({ mainThread: false, lynx: {} });

      await expect(callOnBackground('addFont', 'A', 'a.ttf')).rejects.toThrow(
        'lynx.addFont is not available in this environment',
      );
    });

    it('rejects when lynx is not defined', async () => {
      const { callOnBackground } = await load({ mainThread: false });

      await expect(callOnBackground('resumeExposure')).rejects.toThrow(
        'lynx.resumeExposure is not available in this environment',
      );
    });

    it('resolves addFont when Lynx reports no error', async () => {
      const addFont = vi.fn((_font, done: (err?: unknown) => void) => done());
      const { callOnBackground } = await load({
        mainThread: false,
        lynx: { addFont },
      });

      await callOnBackground('addFont', 'Inter', 'inter.ttf');

      expect(addFont).toHaveBeenCalledWith(
        { 'font-family': 'Inter', src: 'inter.ttf' },
        expect.any(Function),
      );
    });

    it('rejects addFont with the error Lynx reports', async () => {
      const failure = new Error('bad font');
      const { callOnBackground } = await load({
        mainThread: false,
        lynx: {
          addFont: (_font: unknown, done: (e: unknown) => void) =>
            done(failure),
        },
      });

      await expect(callOnBackground('addFont', 'A', 'a.ttf')).rejects.toBe(
        failure,
      );
    });

    it('passes stopExposure an empty object when given no options', async () => {
      const stopExposure = vi.fn();
      const { callOnBackground } = await load({
        mainThread: false,
        lynx: { stopExposure },
      });

      await callOnBackground('stopExposure');
      await callOnBackground('stopExposure', { sendEvent: false });

      expect(stopExposure.mock.calls).toEqual([[{}], [{ sendEvent: false }]]);
    });

    it("answers the OS version from this thread's SystemInfo", async () => {
      const { callOnBackground } = await load({ mainThread: false, lynx: {} });

      await expect(callOnBackground('osVersion')).resolves.toBeUndefined();

      vi.stubGlobal('SystemInfo', { osVersion: '26.1' });
      await expect(callOnBackground('osVersion')).resolves.toBe('26.1');
    });

    it("runs the main thread's fetch on this thread's fetch, and aborts it by ID", async () => {
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              signal = init.signal!;
              signal.addEventListener('abort', () => reject(signal!.reason));
            }),
        ),
      );
      const { callOnBackground } = await load({ mainThread: false, lynx: {} });

      const pending = callOnBackground('fetch', 3, {
        url: 'https://example.com/',
        method: 'GET',
        headers: [],
        body: null,
        options: {},
      });
      await callOnBackground('abortFetch', 3);

      expect(signal!.aborted).toBe(true);
      await expect(pending).rejects.toBeDefined();
    });
  });

  describe('the background thread relay', () => {
    const loadBackground = async (lynx: Record<string, unknown> = {}) => {
      const core = fakeContext();
      await load({
        mainThread: false,
        lynx: { getCoreContext: () => core.context, ...lynx },
      });
      return core;
    };

    const send = async (
      core: ReturnType<typeof fakeContext>,
      message: unknown,
    ) => {
      await core.listeners['AngularLynx.BackgroundCall']!({
        data: JSON.stringify(message),
      });
      return core.dispatched.map((e) => ({
        type: e.type,
        ...JSON.parse(e.data),
      }));
    };

    it('runs a call from the main thread and replies with the result', async () => {
      const resumeExposure = vi.fn();
      const core = await loadBackground({ resumeExposure });

      const replies = await send(core, {
        id: 3,
        name: 'resumeExposure',
        args: [],
      });

      expect(resumeExposure).toHaveBeenCalled();
      expect(replies).toEqual([
        { type: 'AngularLynx.BackgroundCallResult', id: 3 },
      ]);
    });

    it('waits for an asynchronous result before replying', async () => {
      let done: () => void = () => {};
      const core = await loadBackground({
        accessibilityAnnounce: (_opts: unknown, cb: () => void) => (done = cb),
      });

      const reply = send(core, {
        id: 1,
        name: 'accessibilityAnnounce',
        args: ['Hi'],
      });
      expect(core.dispatched).toHaveLength(0);
      done();

      expect(await reply).toEqual([
        { type: 'AngularLynx.BackgroundCallResult', id: 1 },
      ]);
    });

    it('replies with the error message when the call fails', async () => {
      const core = await loadBackground();

      const replies = await send(core, { id: 4, name: 'addFont', args: [] });

      expect(replies).toEqual([
        {
          type: 'AngularLynx.BackgroundCallResult',
          id: 4,
          error: 'lynx.addFont is not available in this environment',
        },
      ]);
    });

    it('replies with an error that is not an Error as a string', async () => {
      const core = await loadBackground({
        addFont: (_font: unknown, done: (e: unknown) => void) =>
          done('font server down'),
      });

      const replies = await send(core, {
        id: 5,
        name: 'addFont',
        args: ['A', 'a.ttf'],
      });

      expect(replies[0].error).toBe('font server down');
    });

    it('replies with an error for an unknown call', async () => {
      const core = await loadBackground();

      const replies = await send(core, { id: 6, name: 'nope', args: [] });

      expect(replies[0].error).toBe('Unknown background call: nope');
    });

    it('subscribes to session storage and forwards each change', async () => {
      let notify: (value: unknown) => void = () => {};
      const subscribeSessionStorage = vi.fn(
        (_key: string, cb: (value: unknown) => void) => {
          notify = cb;
          return 11;
        },
      );
      const unsubscribeSessionStorage = vi.fn();
      const core = await loadBackground({
        subscribeSessionStorage,
        unsubscribeSessionStorage,
      });

      await send(core, {
        id: 7,
        name: 'subscribeSessionStorage',
        args: ['theme', 2],
      });
      notify({ mode: 'dark' });
      await send(core, {
        id: 8,
        name: 'unsubscribeSessionStorage',
        args: [2],
      });

      expect(subscribeSessionStorage).toHaveBeenCalledWith(
        'theme',
        expect.any(Function),
      );
      expect(
        core.dispatched
          .filter((e) => e.type === 'AngularLynx.SessionStorageChange')
          .map((e) => JSON.parse(e.data)),
      ).toEqual([{ relayId: 2, value: { mode: 'dark' } }]);
      expect(unsubscribeSessionStorage).toHaveBeenCalledWith('theme', 11);
    });

    it('ignores an unsubscribe for a subscription it never made', async () => {
      const unsubscribeSessionStorage = vi.fn();
      const core = await loadBackground({ unsubscribeSessionStorage });

      await send(core, {
        id: 9,
        name: 'unsubscribeSessionStorage',
        args: [99],
      });

      expect(unsubscribeSessionStorage).not.toHaveBeenCalled();
    });

    it('installs nothing when getCoreContext throws', async () => {
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

  describe('on the main thread', () => {
    const loadMain = async () => {
      const js = fakeContext();
      const mod = await load({
        mainThread: true,
        lynx: { getJSContext: () => js.context },
      });
      const sent = () => js.dispatched.map((e) => JSON.parse(e.data));
      const reply = (message: unknown) =>
        js.listeners['AngularLynx.BackgroundCallResult']!({
          data: JSON.stringify(message),
        });
      return { mod, js, sent, reply };
    };

    it('sends the call to the background thread and resolves with its reply', async () => {
      const { mod, sent, reply } = await loadMain();

      const call = mod.callOnBackground('accessibilityAnnounce', 'Saved');
      const [message] = sent();
      reply({ id: message.id, value: 'ok' });

      expect(message).toEqual({
        id: message.id,
        name: 'accessibilityAnnounce',
        args: ['Saved'],
      });
      await expect(call).resolves.toBe('ok');
    });

    it('rejects with the error the background thread reports', async () => {
      const { mod, sent, reply } = await loadMain();

      const call = mod.callOnBackground('addFont', 'A', 'a.ttf');
      reply({ id: sent()[0].id, error: 'bad font' });

      await expect(call).rejects.toThrow('bad font');
    });

    it('ignores a reply to a call it is not waiting for', async () => {
      const { reply } = await loadMain();

      expect(() => reply({ id: 123 })).not.toThrow();
    });

    it("rejects when it can't reach the background thread", async () => {
      const { callOnBackground } = await load({ mainThread: true, lynx: {} });

      await expect(
        callOnBackground('setObserverFrameRate', {}),
      ).rejects.toThrow(
        "Can't reach the background thread to call lynx.setObserverFrameRate in this environment",
      );
    });

    it('delivers session storage changes to the subscribed listener', async () => {
      const { mod, js, sent } = await loadMain();
      const listener = vi.fn();

      const relayId = mod.subscribeSessionStorageFromMainThread(
        'theme',
        listener,
      );
      js.listeners['AngularLynx.SessionStorageChange']!({
        data: JSON.stringify({ relayId, value: { mode: 'dark' } }),
      });

      expect(sent()[0]).toMatchObject({
        name: 'subscribeSessionStorage',
        args: ['theme', relayId],
      });
      expect(listener).toHaveBeenCalledWith({ mode: 'dark' });
    });

    it('unsubscribes through the background thread', async () => {
      const { mod, js, sent } = await loadMain();
      const listener = vi.fn();
      const relayId = mod.subscribeSessionStorageFromMainThread(
        'theme',
        listener,
      );

      mod.unsubscribeSessionStorageFromMainThread(relayId);
      mod.unsubscribeSessionStorageFromMainThread(relayId);
      js.listeners['AngularLynx.SessionStorageChange']!({
        data: JSON.stringify({ relayId, value: 1 }),
      });

      expect(sent().map((m) => m.name)).toEqual([
        'subscribeSessionStorage',
        'unsubscribeSessionStorage',
      ]);
      expect(listener).not.toHaveBeenCalled();
    });

    it("drops the listener when the subscription can't reach the background thread", async () => {
      const mod = await load({ mainThread: true, lynx: {} });
      const listener = vi.fn();

      const relayId = mod.subscribeSessionStorageFromMainThread(
        'theme',
        listener,
      );
      await flush();
      mod.unsubscribeSessionStorageFromMainThread(relayId);

      // Nothing to unsubscribe from, so nothing throws or is sent.
      expect(listener).not.toHaveBeenCalled();
    });

    it('swallows an unsubscribe the background thread rejects', async () => {
      const { mod, sent, reply } = await loadMain();
      const relayId = mod.subscribeSessionStorageFromMainThread('k', vi.fn());

      mod.unsubscribeSessionStorageFromMainThread(relayId);
      reply({ id: sent()[1].id, error: 'gone' });
      await flush();

      expect(sent()).toHaveLength(2);
    });

    it('installs nothing when getJSContext throws', async () => {
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

  it('installs nothing when lynx is not defined', async () => {
    await expect(load({ mainThread: true })).resolves.toBeDefined();
  });

  // NativeModules, JS modules and prefetching exist only on the background
  // thread, and Angular runs on the main thread, so LynxNativeModule and
  // LynxResourcePrefetch relay their calls (issue #81).
  describe('relaying modules and callbacks', () => {
    const loadBackground = async (lynx: Record<string, unknown> = {}) => {
      const core = fakeContext();
      const mod = await load({
        mainThread: false,
        lynx: { getCoreContext: () => core.context, ...lynx },
      });
      const send = async (name: string, args: unknown[]) => {
        await core.listeners['AngularLynx.BackgroundCall']!({
          data: JSON.stringify({ id: 1, name, args }),
        });
        const reply = core.dispatched.find(
          (e) => e.type === 'AngularLynx.BackgroundCallResult',
        );
        return JSON.parse(reply!.data);
      };
      const callbacks = () =>
        core.dispatched
          .filter((e) => e.type === 'AngularLynx.Callback')
          .map((e) => JSON.parse(e.data));
      return { core, mod, send, callbacks };
    };

    const loadMain = async () => {
      const js = fakeContext();
      const mod = await load({
        mainThread: true,
        lynx: { getJSContext: () => js.context },
      });
      const sent = () =>
        js.dispatched
          .filter((e) => e.type === 'AngularLynx.BackgroundCall')
          .map((e) => JSON.parse(e.data));
      const callBack = (id: number, args: unknown[]) =>
        js.listeners['AngularLynx.Callback']!({
          data: JSON.stringify({ id, args }),
        });
      return { js, mod, sent, callBack };
    };

    describe('on the background thread', () => {
      it('requests and cancels resource prefetches', async () => {
        const requestResourcePrefetch = vi.fn((_data, done) =>
          done({ code: 0 }),
        );
        const cancelResourcePrefetch = vi.fn((_data, done) =>
          done({ code: 1 }),
        );
        const { mod } = await loadBackground({
          requestResourcePrefetch,
          cancelResourcePrefetch,
        });
        const data = { data: [{ uri: 'a.jpg', type: 'image' }] };

        await expect(
          mod.callOnBackground('requestResourcePrefetch', data),
        ).resolves.toEqual({ code: 0 });
        await expect(
          mod.callOnBackground('cancelResourcePrefetch', data),
        ).resolves.toEqual({ code: 1 });
        expect(requestResourcePrefetch).toHaveBeenCalledWith(
          data,
          expect.any(Function),
        );
      });

      it("resolves a bridge call with the bridge's first value", async () => {
        const call = vi.fn((_name, _params, done) => done('id-1', 'ignored'));
        vi.stubGlobal('NativeModules', { bridge: { call, on: vi.fn() } });
        const { send } = await loadBackground();

        const reply = await send('nativeBridgeCall', ['getId', { a: 1 }]);

        expect(call).toHaveBeenCalledWith(
          'getId',
          { a: 1 },
          expect.any(Function),
        );
        expect(reply).toEqual({ id: 1, value: 'id-1' });
      });

      it('resolves a bridge call undefined without a bridge', async () => {
        const { mod } = await loadBackground();

        await expect(
          mod.callOnBackground('nativeBridgeCall', 'getId', {}),
        ).resolves.toBeUndefined();
      });

      it("sends a bridge event to the main thread's callback", async () => {
        let listener: (...args: unknown[]) => void = () => {};
        vi.stubGlobal('NativeModules', {
          bridge: {
            call: vi.fn(),
            on: (_name: string, fn: (...args: unknown[]) => void) =>
              (listener = fn),
          },
        });
        const { send, callbacks } = await loadBackground();

        await send('nativeBridgeOn', [
          'onDeepLink',
          { __angularLynxCallback: 4 },
        ]);
        listener('app://home', 2);

        expect(callbacks()).toEqual([{ id: 4, args: ['app://home', 2] }]);
      });

      it('calls a native module method on the module, with stand-ins for callbacks', async () => {
        const device = {
          level: 0.5,
          getBatteryLevel(this: { level: number }, done: (v: number) => void) {
            done(this.level);
          },
        };
        vi.stubGlobal('NativeModules', { DeviceModule: device });
        const { send, callbacks } = await loadBackground();

        const reply = await send('callModule', [
          'native',
          'DeviceModule',
          'getBatteryLevel',
          [{ __angularLynxCallback: 7 }],
        ]);

        expect(reply).toEqual({ id: 1 });
        expect(callbacks()).toEqual([{ id: 7, args: [0.5] }]);
      });

      it("replies with a native module method's return value, awaiting a promise", async () => {
        vi.stubGlobal('NativeModules', {
          Info: { version: async () => '4.1' },
        });
        const { send } = await loadBackground();

        const reply = await send('callModule', [
          'native',
          'Info',
          'version',
          [],
        ]);

        expect(reply).toEqual({ id: 1, value: '4.1' });
      });

      it('replies with an error for a native module the host lacks', async () => {
        const { send } = await loadBackground();

        const reply = await send('callModule', ['native', 'Nope', 'run', []]);

        expect(reply.error).toBe('NativeModules: Nope.run is not available');
      });

      it('calls a JS module method, reusing one stand-in per callback', async () => {
        const listeners: Array<(...args: unknown[]) => void> = [];
        const emitter = {
          addListener: (_event: string, fn: (...args: unknown[]) => void) =>
            listeners.push(fn),
        };
        const { send, callbacks } = await loadBackground({
          getJSModule: (name: string) =>
            name === 'GlobalEventEmitter' ? emitter : undefined,
        });

        for (let i = 0; i < 2; i++) {
          await send('callModule', [
            'js',
            'GlobalEventEmitter',
            'addListener',
            ['ping', { __angularLynxCallback: 2 }],
          ]);
        }
        listeners[0]!(['pong']);

        expect(listeners[0]).toBe(listeners[1]);
        expect(callbacks()).toEqual([{ id: 2, args: [['pong']] }]);
      });

      it('replies with an error for a JS module that is not registered', async () => {
        const { send } = await loadBackground({ getJSModule: () => undefined });

        const reply = await send('callModule', ['js', 'Nope', 'emit', []]);

        expect(reply.error).toBe(
          'lynx.getJSModule: Nope.emit is not available',
        );
      });

      it('replies with an error when there is no JS module registry', async () => {
        const { send } = await loadBackground();

        const reply = await send('callModule', ['js', 'Nope', 'emit', []]);

        expect(reply.error).toContain('is not available');
      });

      it('drops callback arguments JSON cannot copy', async () => {
        let listener: (...args: unknown[]) => void = () => {};
        vi.stubGlobal('NativeModules', {
          bridge: {
            call: vi.fn(),
            on: (_name: string, fn: (...args: unknown[]) => void) =>
              (listener = fn),
          },
        });
        const { send, callbacks } = await loadBackground();
        await send('nativeBridgeOn', ['evt', { __angularLynxCallback: 1 }]);
        const circular: Record<string, unknown> = {};
        circular['self'] = circular;

        expect(() => listener(circular)).not.toThrow();
        expect(callbacks()).toEqual([]);
      });

      it('registers a JS module whose methods call back to the main thread', async () => {
        const registerModule = vi.fn();
        const { send, callbacks } = await loadBackground({ registerModule });

        await send('registerJSModule', [
          'shared',
          {
            count: 3,
            items: [1, { __angularLynxCallback: 6 }],
            ping: { __angularLynxCallback: 5 },
          },
        ]);
        const [name, module] = registerModule.mock.calls[0]!;
        module.ping('a');
        module.items[1]('b');

        expect(name).toBe('shared');
        expect(module.count).toBe(3);
        expect(callbacks()).toEqual([
          { id: 5, args: ['a'] },
          { id: 6, args: ['b'] },
        ]);
      });

      it('registers a module made on this thread as it is', async () => {
        const registerModule = vi.fn();
        const { mod } = await loadBackground({ registerModule });
        const module = { values: [1, 2], nested: { a: 1 }, run: () => {} };

        await mod.callOnBackground('registerJSModule', 'own', module);

        expect(registerModule.mock.calls[0]![1]).toBe(module);
      });

      it("replies with an error when the result can't be sent", async () => {
        const circular: Record<string, unknown> = {};
        circular['self'] = circular;
        vi.stubGlobal('NativeModules', { Graph: { get: () => circular } });
        const { send } = await loadBackground();

        const reply = await send('callModule', ['native', 'Graph', 'get', []]);

        expect(reply.error).toContain(
          "The result of callModule can't be sent to the main thread",
        );
      });
    });

    describe('on the main thread', () => {
      it('sends a function as a marker and calls it when the background thread does', async () => {
        const { mod, callBack } = await loadMain();
        const listener = vi.fn();

        const marker = mod.relayFunctions(listener) as {
          __angularLynxCallback: number;
        };
        callBack(marker.__angularLynxCallback, ['a', 1]);

        expect(listener).toHaveBeenCalledWith('a', 1);
      });

      it('gives a function the same marker every time, so removing a listener works', async () => {
        const { mod } = await loadMain();
        const listener = () => {};

        expect(mod.relayFunctions(listener)).toEqual(
          mod.relayFunctions(listener),
        );
        expect(mod.relayFunctions(() => {})).not.toEqual(
          mod.relayFunctions(listener),
        );
      });

      it('relays functions inside arrays and plain objects, called on their object', async () => {
        const { mod, callBack } = await loadMain();
        const options = {
          tag: 'x',
          success(this: { tag: string }) {
            seen.push(this.tag);
          },
        };
        const seen: string[] = [];

        const relayed = mod.relayFunctions(['name', options, 4, null]) as [
          string,
          { tag: string; success: { __angularLynxCallback: number } },
          number,
          null,
        ];
        callBack(relayed[1].success.__angularLynxCallback, []);

        expect(relayed[0]).toBe('name');
        expect(relayed[1].tag).toBe('x');
        expect(relayed[2]).toBe(4);
        expect(seen).toEqual(['x']);
      });

      it('ignores a callback it never sent', async () => {
        const { callBack } = await loadMain();

        expect(() => callBack(999, [])).not.toThrow();
      });

      it("sends a module's methods, including its class's, bound to it", async () => {
        const { mod, callBack } = await loadMain();
        class Counter {
          count = 1;
          label = { text: 'n' };
          increment(by: number) {
            this.count += by;
          }
        }
        const counter = new Counter();

        const relayed = mod.relayModuleObject(counter) as Record<
          string,
          { __angularLynxCallback: number }
        >;
        callBack(relayed['increment']!.__angularLynxCallback, [2]);

        expect(Object.keys(relayed).sort()).toEqual([
          'count',
          'increment',
          'label',
        ]);
        expect(relayed['count']).toBe(1);
        expect(counter.count).toBe(3);
      });

      it("sends a module's calls through a proxy that returns their result", async () => {
        const { mod, sent, js } = await loadMain();
        const device = mod.relayedModule('native', 'DeviceModule') as {
          getBatteryLevel(done: (level: number) => void): Promise<unknown>;
        };
        const done = vi.fn();

        const result = device.getBatteryLevel(done);
        const [message] = sent();
        js.listeners['AngularLynx.BackgroundCallResult']!({
          data: JSON.stringify({ id: message.id, value: 'ok' }),
        });

        expect(message.name).toBe('callModule');
        expect(message.args.slice(0, 3)).toEqual([
          'native',
          'DeviceModule',
          'getBatteryLevel',
        ]);
        expect(message.args[3]).toEqual([
          { __angularLynxCallback: expect.any(Number) },
        ]);
        await expect(result).resolves.toBe('ok');
      });

      it('returns the same proxy and methods for the same module', async () => {
        const { mod } = await loadMain();
        const a = mod.relayedModule('js', 'Emitter') as Record<string, unknown>;
        const b = mod.relayedModule('js', 'Emitter') as Record<string, unknown>;

        expect(a).toBe(b);
        expect(a['emit']).toBe(b['emit']);
        expect(mod.relayedModule('native', 'Emitter')).not.toBe(a);
      });

      it("isn't mistaken for a promise", async () => {
        const { mod } = await loadMain();
        const proxy = mod.relayedModule('native', 'DeviceModule') as Record<
          string | symbol,
          unknown
        >;

        expect(proxy['then']).toBeUndefined();
        expect(proxy[Symbol.toPrimitive]).toBeUndefined();
        await expect(Promise.resolve(proxy)).resolves.toBe(proxy);
      });
    });

    it('leaves functions alone off the main thread', async () => {
      const { mod } = await loadBackground();
      const fn = () => {};
      const module = { fn };

      expect(mod.relayFunctions(fn)).toBe(fn);
      expect(mod.relayModuleObject(module)).toBe(module);
    });
  });
});
