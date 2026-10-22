import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backgroundFn, type BackgroundFnHandle } from './background-fn';

/**
 * The number in a handle's ID. The module-level counter carries on across
 * tests in the same worker, so tests compare IDs rather than expect fixed ones.
 */
const idNumber = (handle: BackgroundFnHandle): number =>
  Number(handle._wkltId.replace('__angular_bg_', ''));

describe('backgroundFn', () => {
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

      const handle = backgroundFn(fn);

      expect(registerWorklet).toHaveBeenCalledWith(
        'background',
        handle._wkltId,
        fn,
      );
    });

    it('returns a handle with the expected shape', () => {
      vi.stubGlobal('registerWorklet', vi.fn());

      const handle: BackgroundFnHandle = backgroundFn(() => 1);

      expect(handle).toEqual({
        _wkltId: expect.stringMatching(/^__angular_bg_\d+$/),
        _workletType: 'background',
        __isBackgroundFn: true,
      });
    });

    it('increments the id on each call', () => {
      vi.stubGlobal('registerWorklet', vi.fn());

      const first = backgroundFn(() => 1);
      const second = backgroundFn(() => 2);

      expect(idNumber(second)).toBe(idNumber(first) + 1);
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
      const first = backgroundFn(() => 'hi');
      const second = backgroundFn(() => 'there');

      expect(second).toEqual({
        _wkltId: `__angular_bg_${idNumber(first) + 1}`,
        _workletType: 'background',
        __isBackgroundFn: true,
      });
    });
  });
});
