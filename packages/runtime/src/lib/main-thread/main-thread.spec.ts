import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxMainThread } from './main-thread';
import type { MainThreadFnHandle } from './main-thread-fn';

const makeHandle = (id: string): MainThreadFnHandle =>
  ({
    _wkltId: id,
    _workletType: 'main-thread',
    __isMainThreadFn: true,
  }) as MainThreadFnHandle;

describe('LynxMainThread.runOnMainThread', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).__lynxRunMainThreadWorklet;
    delete (globalThis as any).__lynxMtsPendingResolvers;
    delete (globalThis as any).__lynxMtsNextResolveId;
  });

  describe('when already on the main thread', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', true);
      vi.stubGlobal('__DEV__', false);
    });

    it('invokes the target worklet directly and resolves with its return value', async () => {
      // The renderer registers (bind*) handlers as main-thread worklets, so a
      // runOnMainThread() call originating from such a handler is already on the
      // main thread and must run the worklet in-place, not dispatch an RPC.
      const worklet = vi.fn((a: number, b: number) => a + b);
      vi.stubGlobal(
        '__lynxRunMainThreadWorklet',
        (id: string, args: unknown[]) => {
          expect(id).toBe('mts-add');
          return (worklet as any)(...args);
        },
      );

      const mts = new LynxMainThread();
      const result = await mts.runOnMainThread(makeHandle('mts-add'), 2, 3);

      expect(worklet).toHaveBeenCalledWith(2, 3);
      expect(result).toBe(5);
    });

    it('does not dispatch a cross-thread event', async () => {
      vi.stubGlobal('__lynxRunMainThreadWorklet', () => undefined);
      const dispatchEvent = vi.fn();
      vi.stubGlobal('lynx', {
        getCoreContext: () => ({ dispatchEvent }),
      });

      const mts = new LynxMainThread();
      await mts.runOnMainThread(makeHandle('mts-noop'));

      expect(dispatchEvent).not.toHaveBeenCalled();
    });

    it('rejects when the worklet throws instead of surfacing a synchronous error', async () => {
      const boom = new Error('worklet failed');
      vi.stubGlobal('__lynxRunMainThreadWorklet', () => {
        throw boom;
      });

      const mts = new LynxMainThread();
      await expect(mts.runOnMainThread(makeHandle('mts-throws'))).rejects.toBe(
        boom,
      );
    });

    it('rejects when the runtime worklet registry is unavailable', async () => {
      // __lynxRunMainThreadWorklet is installed by runtime.ts; if it is missing
      // (runtime not initialized) we reject rather than throw synchronously.
      const mts = new LynxMainThread();
      await expect(
        mts.runOnMainThread(makeHandle('mts-early')),
      ).rejects.toThrow(/worklet registry was initialized/);
    });
  });

  describe('when on the background thread', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      vi.stubGlobal('__DEV__', false);
    });

    it('dispatches a runWorkletCtx event and resolves via the pending resolver', async () => {
      const dispatchEvent = vi.fn();
      vi.stubGlobal('lynx', {
        getCoreContext: () => ({ dispatchEvent }),
      });

      const pendingResolvers: Record<
        number,
        { resolve: (v: unknown) => void; reject: (e: unknown) => void }
      > = {};
      vi.stubGlobal('__lynxMtsPendingResolvers', pendingResolvers);
      let nextId = 7;
      vi.stubGlobal('__lynxMtsNextResolveId', () => nextId++);

      const mts = new LynxMainThread();
      const promise = mts.runOnMainThread(makeHandle('bg-call'), 'red');

      // The RPC request was dispatched to the main thread.
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(dispatchEvent.mock.calls[0][0].data);
      expect(payload).toMatchObject({
        worklet: { _wkltId: 'bg-call' },
        params: ['red'],
        resolveId: 7,
      });

      // The resolver is registered so the FunctionCallRet listener can settle it.
      expect(pendingResolvers[7]).toBeDefined();
      pendingResolvers[7].resolve('done');
      await expect(promise).resolves.toBe('done');
    });
  });
});
