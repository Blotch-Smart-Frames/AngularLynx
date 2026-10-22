import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __workletMap } from '../worklet-bridge';
import { mainThreadFn, type MainThreadFnHandle } from './main-thread-fn';

/**
 * The number in a handle's ID. The module-level counter carries on across
 * tests in the same worker, so tests compare IDs rather than expect fixed ones.
 */
const idNumber = (handle: MainThreadFnHandle): number =>
  Number(handle._wkltId.replace('__angular_mts_', ''));

/**
 * Stands in for the runtime's registerWorklet global, which stores the
 * function in __workletMap.
 */
const registerInMap = (_type: string, id: string, fn: Function): void => {
  __workletMap[id] = fn;
};

describe('mainThreadFn', () => {
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

      const handle = mainThreadFn(fn);

      expect(registerWorklet).toHaveBeenCalledWith(
        'main-thread',
        handle._wkltId,
        fn,
      );
    });

    it('returns a handle with the expected shape', () => {
      vi.stubGlobal('registerWorklet', vi.fn());

      const handle: MainThreadFnHandle = mainThreadFn(() => 1);

      expect(handle).toEqual({
        _wkltId: expect.stringMatching(/^__angular_mts_\d+$/),
        _workletType: 'main-thread',
        __isMainThreadFn: true,
      });
    });

    it('increments the id on each call', () => {
      vi.stubGlobal('registerWorklet', vi.fn());

      const first = mainThreadFn(() => 1);
      const second = mainThreadFn(() => 2);

      expect(idNumber(second)).toBe(idNumber(first) + 1);
    });

    it('releases a function created in an injection context when its injector is destroyed', () => {
      vi.stubGlobal('registerWorklet', registerInMap);
      const injector = Injector.create({ providers: [] });
      const fn = () => 'instance';

      const handle = runInInjectionContext(injector, () => mainThreadFn(fn));

      expect(__workletMap[handle._wkltId]).toBe(fn);
      injector.destroy();
      expect(handle._wkltId in __workletMap).toBe(false);
    });

    it('keeps a function created outside an injection context registered', () => {
      vi.stubGlobal('registerWorklet', registerInMap);
      const fn = () => 'module';

      const handle = mainThreadFn(fn);

      expect(__workletMap[handle._wkltId]).toBe(fn);
      delete __workletMap[handle._wkltId];
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
      const first = mainThreadFn(() => 'hi');
      const second = mainThreadFn(() => 'there');

      expect(second).toEqual({
        _wkltId: `__angular_mts_${idNumber(first) + 1}`,
        _workletType: 'main-thread',
        __isMainThreadFn: true,
      });
    });
  });
});
