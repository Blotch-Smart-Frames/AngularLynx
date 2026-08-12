import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetWorkletCounter,
  mainThreadFn,
  type MainThreadFnHandle,
} from './main-thread-fn';

describe('mainThreadFn', () => {
  // The module-level ID counter persists across tests in the same worker, so
  // every test resets it first to get a deterministic '__angular_mts_0' start.
  beforeEach(() => {
    __resetWorkletCounter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('on the main thread (__MAIN_THREAD__ true)', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', true);
    });

    it('registers the function with globalThis.registerWorklet', () => {
      const registerWorklet = vi.fn();
      vi.stubGlobal('registerWorklet', registerWorklet);
      const fn = () => 'hi';

      mainThreadFn(fn);

      expect(registerWorklet).toHaveBeenCalledWith(
        'main-thread',
        '__angular_mts_0',
        fn,
      );
    });

    it('returns a handle with the expected shape', () => {
      vi.stubGlobal('registerWorklet', vi.fn());

      const handle: MainThreadFnHandle = mainThreadFn(() => 1);

      expect(handle).toEqual({
        _wkltId: '__angular_mts_0',
        _workletType: 'main-thread',
        __isMainThreadFn: true,
      });
    });

    it('increments the id on each call', () => {
      vi.stubGlobal('registerWorklet', vi.fn());

      const first = mainThreadFn(() => 1);
      const second = mainThreadFn(() => 2);

      expect(first._wkltId).toBe('__angular_mts_0');
      expect(second._wkltId).toBe('__angular_mts_1');
    });
  });

  describe('on the background thread (__MAIN_THREAD__ false)', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', false);
    });

    it('does not register the function', () => {
      const registerWorklet = vi.fn();
      vi.stubGlobal('registerWorklet', registerWorklet);

      mainThreadFn(() => 'hi');

      expect(registerWorklet).not.toHaveBeenCalled();
    });

    it('still returns a handle with an incrementing id', () => {
      const handle = mainThreadFn(() => 'hi');

      expect(handle).toEqual({
        _wkltId: '__angular_mts_0',
        _workletType: 'main-thread',
        __isMainThreadFn: true,
      });
    });
  });

  describe('__resetWorkletCounter', () => {
    it('resets the id counter back to 0', () => {
      vi.stubGlobal('__MAIN_THREAD__', false);

      mainThreadFn(() => 1);
      mainThreadFn(() => 2);
      __resetWorkletCounter();
      const handle = mainThreadFn(() => 3);

      expect(handle._wkltId).toBe('__angular_mts_0');
    });
  });
});
