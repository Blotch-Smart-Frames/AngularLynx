import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetBgWorkletCounter,
  backgroundFn,
  type BackgroundFnHandle,
} from './background-fn';

describe('backgroundFn', () => {
  // The module-level ID counter persists across tests in the same worker, so
  // every test resets it first to get a deterministic '__angular_bg_0' start.
  beforeEach(() => {
    __resetBgWorkletCounter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('on the background thread (__MAIN_THREAD__ false)', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', false);
    });

    it('registers the function with globalThis.registerWorklet', () => {
      const registerWorklet = vi.fn();
      vi.stubGlobal('registerWorklet', registerWorklet);
      const fn = () => 'hi';

      backgroundFn(fn);

      expect(registerWorklet).toHaveBeenCalledWith(
        'background',
        '__angular_bg_0',
        fn,
      );
    });

    it('returns a handle with the expected shape', () => {
      vi.stubGlobal('registerWorklet', vi.fn());

      const handle: BackgroundFnHandle = backgroundFn(() => 1);

      expect(handle).toEqual({
        _wkltId: '__angular_bg_0',
        _workletType: 'background',
        __isBackgroundFn: true,
      });
    });

    it('increments the id on each call', () => {
      vi.stubGlobal('registerWorklet', vi.fn());

      const first = backgroundFn(() => 1);
      const second = backgroundFn(() => 2);

      expect(first._wkltId).toBe('__angular_bg_0');
      expect(second._wkltId).toBe('__angular_bg_1');
    });
  });

  describe('on the main thread (__MAIN_THREAD__ true)', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', true);
    });

    it('does not register the function', () => {
      const registerWorklet = vi.fn();
      vi.stubGlobal('registerWorklet', registerWorklet);

      backgroundFn(() => 'hi');

      expect(registerWorklet).not.toHaveBeenCalled();
    });

    it('still returns a handle with an incrementing id', () => {
      const handle = backgroundFn(() => 'hi');

      expect(handle).toEqual({
        _wkltId: '__angular_bg_0',
        _workletType: 'background',
        __isBackgroundFn: true,
      });
    });
  });

  describe('__resetBgWorkletCounter', () => {
    it('resets the id counter back to 0', () => {
      vi.stubGlobal('__MAIN_THREAD__', true);

      backgroundFn(() => 1);
      backgroundFn(() => 2);
      __resetBgWorkletCounter();
      const handle = backgroundFn(() => 3);

      expect(handle._wkltId).toBe('__angular_bg_0');
    });
  });
});
