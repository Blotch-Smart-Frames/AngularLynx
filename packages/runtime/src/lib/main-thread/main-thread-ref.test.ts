import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  });

  describe('on the main thread (__MAIN_THREAD__ true)', () => {
    let refMap: Record<number, unknown>;

    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', true);
      refMap = {};
      vi.stubGlobal('__workletRefMap', refMap);
    });

    it('registers itself in __workletRefMap under its _wvid', () => {
      const ref = new MainThreadRef('initial');

      expect(refMap[ref._wvid]).toBe(ref);
    });

    it('assigns incrementing _wvid values across instances', () => {
      const first = new MainThreadRef(1);
      const second = new MainThreadRef(2);

      expect(first._wvid).toBe(0);
      expect(second._wvid).toBe(1);
    });
  });

  describe('on the background thread (__MAIN_THREAD__ false)', () => {
    beforeEach(() => {
      vi.stubGlobal('__MAIN_THREAD__', false);
    });

    it('does not touch __workletRefMap', () => {
      // No __workletRefMap global is stubbed at all here — if the constructor
      // tried to register, it would throw on `undefined[this._wvid] = this`.
      expect(() => new MainThreadRef('value')).not.toThrow();
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
