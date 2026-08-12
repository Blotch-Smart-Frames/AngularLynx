import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPageId, setPageElementRef } from './page-ref';

describe('page-ref', () => {
  afterEach(() => {
    setPageElementRef(null);
    vi.unstubAllGlobals();
  });

  describe('getPageId', () => {
    it('returns 0 when the root has not been created yet', () => {
      // The afterEach hook resets the ref to null before this runs.
      expect(getPageId()).toBe(0);
    });

    it('returns __GetElementUniqueID(__pageElementRef) when the root exists', () => {
      const ref = { _id: 99 } as unknown as Parameters<
        typeof setPageElementRef
      >[0];
      setPageElementRef(ref);
      vi.stubGlobal(
        '__GetElementUniqueID',
        vi.fn(() => 99),
      );
      expect(getPageId()).toBe(99);
    });
  });

  describe('setPageElementRef', () => {
    it('is observed by later getPageId calls', () => {
      vi.stubGlobal(
        '__GetElementUniqueID',
        vi.fn(() => 5),
      );
      expect(getPageId()).toBe(0); // null → 0
      setPageElementRef({ _id: 5 } as unknown as Parameters<
        typeof setPageElementRef
      >[0]);
      expect(getPageId()).toBe(5);
      setPageElementRef(null);
      expect(getPageId()).toBe(0);
    });
  });
});
