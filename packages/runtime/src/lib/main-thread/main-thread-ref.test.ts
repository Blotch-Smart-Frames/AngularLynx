import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __mainThreadRefMap } from '../worklet-bridge';
import {
  __resetRefCounter,
  createMainThreadRef,
  MainThreadRef,
} from './main-thread-ref';

describe('MainThreadRef', () => {
  // The module-level ID counter persists across tests in the same worker, so
  // every test resets it first to get a deterministic id=0 start.
  beforeEach(() => {
    __resetRefCounter();
  });

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

    it('assigns incrementing _wvid values across instances', () => {
      const first = new MainThreadRef(1);
      const second = new MainThreadRef(2);

      expect(first._wvid).toBe(0);
      expect(second._wvid).toBe(1);
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

  describe('__resetRefCounter', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', false);
    });

    it('resets the id counter back to 0', () => {
      new MainThreadRef('a');
      new MainThreadRef('b');
      __resetRefCounter();
      const ref = new MainThreadRef('c');

      expect(ref._wvid).toBe(0);
    });
  });
});
