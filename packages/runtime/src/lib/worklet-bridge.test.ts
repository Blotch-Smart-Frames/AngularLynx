import { afterEach, describe, expect, it } from 'vitest';
import { MainThreadElement } from './main-thread/main-thread-element';
import {
  __mainThreadRefMap,
  __pendingResolvers,
  __workletMap,
  nextResolveId,
  transformParams,
} from './worklet-bridge';

describe('worklet-bridge', () => {
  afterEach(() => {
    for (const key of Object.keys(__mainThreadRefMap)) {
      delete __mainThreadRefMap[key as unknown as number];
    }
    for (const key of Object.keys(__workletMap)) delete __workletMap[key];
    for (const key of Object.keys(__pendingResolvers)) {
      delete __pendingResolvers[key as unknown as number];
    }
  });

  describe('registry maps', () => {
    it('starts as empty plain objects', () => {
      expect(Object.keys(__workletMap)).toHaveLength(0);
      expect(Object.keys(__mainThreadRefMap)).toHaveLength(0);
      expect(Object.keys(__pendingResolvers)).toHaveLength(0);
    });
  });

  describe('nextResolveId', () => {
    it('returns a monotonically increasing sequence', () => {
      const first = nextResolveId();
      const second = nextResolveId();
      const third = nextResolveId();
      expect(second).toBe(first + 1);
      expect(third).toBe(second + 1);
    });
  });

  describe('transformParams', () => {
    it('passes primitives through unchanged', () => {
      expect(transformParams(42)).toBe(42);
      expect(transformParams('hello')).toBe('hello');
      expect(transformParams(true)).toBe(true);
      expect(transformParams(null)).toBe(null);
      expect(transformParams(undefined)).toBe(undefined);
    });

    it('wraps elementRefptr objects in a MainThreadElement', () => {
      const result = transformParams({ elementRefptr: { nativeId: 1 } });
      expect(result).toBeInstanceOf(MainThreadElement);
    });

    it('resolves _wvid entries from __mainThreadRefMap', () => {
      const ref = { current: 'native-el' };
      __mainThreadRefMap[99] = ref;
      expect(transformParams({ _wvid: 99 })).toBe(ref);
    });

    it('leaves the raw object when _wvid is absent from the refMap', () => {
      const raw = { _wvid: 999 };
      expect(transformParams(raw)).toEqual({ _wvid: 999 });
    });

    it('maps array elements recursively', () => {
      expect(transformParams([1, 'two', true])).toEqual([1, 'two', true]);
    });

    it('recursively transforms nested plain objects, resolving deep refs', () => {
      const ref = { current: 'deep' };
      __mainThreadRefMap[77] = ref;
      const result = transformParams({ nested: { _wvid: 77 }, other: 5 }) as {
        nested: unknown;
        other: number;
      };
      expect(result.nested).toBe(ref);
      expect(result.other).toBe(5);
    });

    it('recurses into arrays that contain refs', () => {
      const ref = { current: 'in-array' };
      __mainThreadRefMap[3] = ref;
      const result = transformParams([{ _wvid: 3 }]) as unknown[];
      expect(result[0]).toBe(ref);
    });
  });
});
