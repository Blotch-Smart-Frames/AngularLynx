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
});
