import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __mainThreadRefMap } from '../worklet-bridge';
import { createMainThreadRef, MainThreadRef } from './main-thread-ref';

describe('MainThreadRef', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(__mainThreadRefMap)) {
      delete __mainThreadRefMap[key as unknown as number];
    }
  });

  // Both threads register, so a ref passed from the other thread as a
  // { _wvid } marker resolves to this thread's instance.
  describe.each([true, false])('with __MAIN_THREAD__ %s', (mainThread) => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', mainThread);
    });

    it('registers itself in __mainThreadRefMap under its _wvid', () => {
      const ref = new MainThreadRef('initial');

      expect(__mainThreadRefMap[ref._wvid]).toBe(ref);
    });

    // The module-level counter carries on across tests in the same worker,
    // so this compares the IDs rather than expecting fixed ones.
    it('assigns incrementing _wvid values across instances', () => {
      const first = new MainThreadRef(1);
      const second = new MainThreadRef(2);

      expect(second._wvid).toBe(first._wvid + 1);
    });
  });

  describe('current getter/setter', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', false);
    });

    it('returns the value passed to the constructor', () => {
      const ref = new MainThreadRef('a');

      expect(ref.current).toBe('a');
    });

    it('updates the value when set', () => {
      const ref = new MainThreadRef('a');

      ref.current = 'b';

      expect(ref.current).toBe('b');
    });
  });

  describe('toJSON', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', false);
    });

    it('serializes to an object containing only _wvid', () => {
      const ref = new MainThreadRef('a');

      expect(ref.toJSON()).toEqual({ _wvid: ref._wvid });
    });
  });

  describe('createMainThreadRef', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', false);
    });

    it('returns a MainThreadRef instance seeded with the given value', () => {
      const ref = createMainThreadRef(42);

      expect(ref).toBeInstanceOf(MainThreadRef);
      expect(ref.current).toBe(42);
    });
  });
});
