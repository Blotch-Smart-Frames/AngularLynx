import { afterEach, describe, expect, it } from 'vitest';
import { registerDataProcessors } from './data-processors';

describe('registerDataProcessors', () => {
  afterEach(() => {
    delete (globalThis as any).processData;
  });

  describe('registration', () => {
    it('sets globalThis.processData when called', () => {
      registerDataProcessors({});

      expect(typeof (globalThis as any).processData).toBe('function');
    });

    it('overwrites a pre-existing globalThis.processData when called again', () => {
      registerDataProcessors({ defaultDataProcessor: () => ({ v: 1 }) });
      registerDataProcessors({ defaultDataProcessor: () => ({ v: 2 }) });

      const result = (globalThis as any).processData({});

      expect(result).toEqual({ v: 2 });
    });
  });

  describe('default processor path — no processorName given', () => {
    it('returns raw data unchanged when definition has no defaultDataProcessor', () => {
      registerDataProcessors({});

      const result = (globalThis as any).processData({ foo: 'bar' });

      expect(result).toEqual({ foo: 'bar' });
    });

    it('returns the transformed result from defaultDataProcessor', () => {
      registerDataProcessors({
        defaultDataProcessor: (raw) => ({ ...raw, added: true }),
      });

      const result = (globalThis as any).processData({ x: 1 });

      expect(result).toEqual({ x: 1, added: true });
    });

    it('falls back to raw data when defaultDataProcessor returns undefined', () => {
      registerDataProcessors({
        defaultDataProcessor: () => undefined as any,
      });

      const result = (globalThis as any).processData({ keep: 'me' });

      expect(result).toEqual({ keep: 'me' });
    });

    it('returns {} when defaultDataProcessor throws', () => {
      registerDataProcessors({
        defaultDataProcessor: () => {
          throw new Error('boom');
        },
      });

      const result = (globalThis as any).processData({});

      expect(result).toEqual({});
    });
  });

  describe('named processor path — processorName is a non-empty string', () => {
    it('returns the transformed result from the matching named processor', () => {
      registerDataProcessors({
        dataProcessors: { parse: (raw) => ({ parsed: true, ...raw }) },
      });

      const result = (globalThis as any).processData({ x: 1 }, 'parse');

      expect(result).toEqual({ parsed: true, x: 1 });
    });

    it('falls back to raw data when dataProcessors is not defined on the definition', () => {
      registerDataProcessors({});

      const result = (globalThis as any).processData({ y: 2 }, 'anything');

      expect(result).toEqual({ y: 2 });
    });

    it('falls back to raw data when the named processor key does not exist in dataProcessors', () => {
      registerDataProcessors({
        dataProcessors: { other: () => ({ nope: true }) },
      });

      const result = (globalThis as any).processData({ z: 3 }, 'missing');

      expect(result).toEqual({ z: 3 });
    });

    it('falls back to raw data when the named processor returns undefined', () => {
      registerDataProcessors({
        dataProcessors: { noop: () => undefined },
      });

      const result = (globalThis as any).processData({ a: 1 }, 'noop');

      expect(result).toEqual({ a: 1 });
    });

    it('returns {} when the named processor throws', () => {
      registerDataProcessors({
        dataProcessors: {
          bad: () => {
            throw new Error('crash');
          },
        },
      });

      const result = (globalThis as any).processData({}, 'bad');

      expect(result).toEqual({});
    });
  });

  describe('edge cases', () => {
    it('treats empty-string processorName as falsy and routes to the default processor path', () => {
      registerDataProcessors({
        defaultDataProcessor: () => ({ routed: 'default' }),
        // The '' key is never reached because if (processorName) is falsy for ''.
        dataProcessors: { '': () => ({ routed: 'named' }) },
      });

      const result = (globalThis as any).processData({}, '');

      expect(result).toEqual({ routed: 'default' });
    });

    it('routes to the named processor when processorName is given even when defaultDataProcessor is also defined', () => {
      registerDataProcessors({
        defaultDataProcessor: () => ({ from: 'default' }),
        dataProcessors: { special: () => ({ from: 'named' }) },
      });

      const result = (globalThis as any).processData({}, 'special');

      expect(result).toEqual({ from: 'named' });
    });
  });
});
