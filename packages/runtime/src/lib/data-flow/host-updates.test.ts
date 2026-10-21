import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyGlobalDataUpdate,
  applyInitDataUpdate,
  globalDataUpdates,
  initDataUpdates,
} from './host-updates';

describe('host updates', () => {
  let host: Record<string, unknown>;

  beforeEach(() => {
    host = {};
    (globalThis as any).lynx = host;
  });

  afterEach(() => {
    delete (globalThis as any).lynx;
  });

  describe('applyInitDataUpdate()', () => {
    it('merges the update into lynx.__initData', () => {
      host['__initData'] = { userId: 'abc', theme: 'light' };

      applyInitDataUpdate({ theme: 'dark' }, false);

      expect(host['__initData']).toEqual({ userId: 'abc', theme: 'dark' });
    });

    it('starts from an empty object when resetting', () => {
      host['__initData'] = { userId: 'abc' };

      applyInitDataUpdate({ theme: 'dark' }, true);

      expect(host['__initData']).toEqual({ theme: 'dark' });
    });

    it('starts from an empty object when there is no InitData yet', () => {
      applyInitDataUpdate({ theme: 'dark' }, false);

      expect(host['__initData']).toEqual({ theme: 'dark' });
    });

    it('treats data that is not an object as no change', () => {
      host['__initData'] = { userId: 'abc' };

      applyInitDataUpdate(undefined, false);
      applyInitDataUpdate('text', false);

      expect(host['__initData']).toEqual({ userId: 'abc' });
    });

    it('stores a new object, so signals holding the old one see a change', () => {
      const before = { userId: 'abc' };
      host['__initData'] = before;

      applyInitDataUpdate({}, false);

      expect(host['__initData']).not.toBe(before);
    });

    it('publishes and returns the merged data', () => {
      host['__initData'] = { userId: 'abc' };
      const published: unknown[] = [];
      const subscription = initDataUpdates.subscribe((d) => published.push(d));

      const result = applyInitDataUpdate({ theme: 'dark' }, false);
      subscription.unsubscribe();

      expect(published).toEqual([{ userId: 'abc', theme: 'dark' }]);
      expect(result).toBe(published[0]);
    });
  });

  describe('applyGlobalDataUpdate()', () => {
    it('merges the update into lynx.__globalProps', () => {
      host['__globalProps'] = { theme: 'Light', appLocale: 'en-US' };

      applyGlobalDataUpdate({ theme: 'Dark' });

      expect(host['__globalProps']).toEqual({
        theme: 'Dark',
        appLocale: 'en-US',
      });
    });

    it('starts from an empty object when there are no global props yet', () => {
      applyGlobalDataUpdate({ theme: 'Dark' });

      expect(host['__globalProps']).toEqual({ theme: 'Dark' });
    });

    it('publishes and returns the merged data', () => {
      const published: unknown[] = [];
      const subscription = globalDataUpdates.subscribe((d) =>
        published.push(d),
      );

      const result = applyGlobalDataUpdate({ theme: 'Dark' });
      subscription.unsubscribe();

      expect(published).toEqual([{ theme: 'Dark' }]);
      expect(result).toBe(published[0]);
    });
  });
});
