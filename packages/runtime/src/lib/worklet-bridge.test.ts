import { afterEach, describe, expect, it } from 'vitest';
import { MainThreadElement } from './main-thread/main-thread-element';
import {
  __mainThreadRefMap,
  __pendingResolvers,
  __workletMap,
  answerCall,
  nextResolveId,
  restoreRefs,
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

  describe('restoreRefs', () => {
    it('resolves _wvid entries, nested ones too, from __mainThreadRefMap', () => {
      const ref = { current: 'bg-copy' };
      __mainThreadRefMap[5] = ref;
      const result = restoreRefs({ list: [{ _wvid: 5 }], n: 1 }) as {
        list: unknown[];
        n: number;
      };
      expect(result.list[0]).toBe(ref);
      expect(result.n).toBe(1);
    });

    it('leaves elementRefptr objects alone, since MainThreadElement is main-thread only', () => {
      const raw = { elementRefptr: { nativeId: 1 } };
      expect(restoreRefs(raw)).toEqual(raw);
      expect(restoreRefs(raw)).not.toBeInstanceOf(MainThreadElement);
    });
  });

  describe('answerCall', () => {
    /**
     * Runs answerCall and returns the parsed replies it has sent so far, plus
     * a promise that resolves once it has sent one.
     */
    const answer = (run: () => unknown) => {
      const replies: Record<string, unknown>[] = [];
      let sent!: () => void;
      const done = new Promise<void>((resolve) => (sent = resolve));
      answerCall(7, run, (data) => {
        replies.push(JSON.parse(data));
        sent();
      });
      return { replies, done };
    };

    it('replies to a synchronous result right away', () => {
      const { replies } = answer(() => ({ n: 1 }));
      expect(replies).toEqual([{ resolveId: 7, returnValue: { n: 1 } }]);
    });

    it('replies with no returnValue when the function returns nothing', () => {
      const { replies } = answer(() => undefined);
      expect(replies).toEqual([{ resolveId: 7 }]);
    });

    it("sends a thrown Error's message, which the caller rejects with", () => {
      const { replies } = answer(() => {
        throw new Error('kaboom');
      });
      expect(replies).toEqual([{ resolveId: 7, error: 'kaboom' }]);
    });

    it('sends any other thrown value as a string', () => {
      const { replies } = answer(() => {
        throw 404;
      });
      expect(replies).toEqual([{ resolveId: 7, error: '404' }]);
    });

    it('awaits a returned promise and replies with its value', async () => {
      const { replies, done } = answer(async () => {
        await Promise.resolve();
        return 42;
      });
      expect(replies).toEqual([]);
      await done;
      expect(replies).toEqual([{ resolveId: 7, returnValue: 42 }]);
    });

    it('sends a rejection as the error instead of leaving it unhandled', async () => {
      const { replies, done } = answer(() => Promise.reject(new Error('nope')));
      await done;
      expect(replies).toEqual([{ resolveId: 7, error: 'nope' }]);
    });

    it('sends an error when the result is not JSON-serializable', () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      const { replies } = answer(() => circular);
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ resolveId: 7 });
      expect(replies[0]!['error']).toContain(
        "can't be sent to the other thread",
      );
    });
  });
});
