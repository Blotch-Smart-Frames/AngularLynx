import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import type { ElementRef } from '../types/lynx';

type FakeArena = {
  setDetector: Mock;
  removeDetector: Mock;
  setState: Mock;
  afterDispatch: () => void;
};

const arenas: FakeArena[] = [];

vi.mock('./web/arena', () => ({
  WebGestureArena: class {
    readonly setDetector = vi.fn();
    readonly removeDetector = vi.fn();
    readonly setState = vi.fn();
    constructor(readonly afterDispatch: () => void) {
      arenas.push(this as never);
    }
  },
}));

const node = {} as ElementRef;
const config = { callbacks: [], config: { enabled: true } };
const relations = { waitFor: [1], simultaneous: [], continueWith: [] };

/**
 * A fresh copy of the module, without an arena yet.
 */
const load = async () => {
  vi.resetModules();
  return import('./gesture-papi');
};

/**
 * Lets the arena's import resolve.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('gesture PAPIs', () => {
  beforeEach(() => {
    arenas.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('on iOS and Android', () => {
    it("call Lynx's own", async () => {
      const papi = {
        __SetGestureDetector: vi.fn(),
        __RemoveGestureDetector: vi.fn(),
        __SetGestureState: vi.fn(),
        __ConsumeGesture: vi.fn(),
      };
      for (const [name, fn] of Object.entries(papi)) vi.stubGlobal(name, fn);
      vi.stubGlobal('__WEB__', false);
      const gestures = await load();

      gestures.setGestureDetector(node, 3, 0, config, relations);
      gestures.removeGestureDetector(node, 3);
      gestures.setGestureState(node, 3, 2);
      gestures.consumeGesture(node, 3, { consume: true });

      expect(papi.__SetGestureDetector).toHaveBeenCalledWith(
        node,
        3,
        0,
        config,
        relations,
      );
      expect(papi.__RemoveGestureDetector).toHaveBeenCalledWith(node, 3);
      expect(papi.__SetGestureState).toHaveBeenCalledWith(node, 3, 2);
      expect(papi.__ConsumeGesture).toHaveBeenCalledWith(node, 3, {
        consume: true,
      });
      expect(arenas).toEqual([]);
    });
  });

  describe('on the web', () => {
    beforeEach(() => {
      vi.stubGlobal('__WEB__', true);
      vi.stubGlobal('__MAIN_THREAD__', true);
      vi.stubGlobal('__ConsumeGesture', vi.fn());
    });

    it('load the arena on first use, then run in order', async () => {
      const gestures = await load();

      gestures.setGestureDetector(node, 3, 0, config, relations);
      gestures.setGestureState(node, 3, 2);
      expect(arenas).toEqual([]);

      await settle();
      expect(arenas).toHaveLength(1);
      const [arena] = arenas;
      expect(arena.setDetector).toHaveBeenCalledWith(
        node,
        3,
        0,
        config,
        relations,
      );
      expect(arena.setState).toHaveBeenCalledWith(node, 3, 2);
      expect(arena.setDetector.mock.invocationCallOrder[0]).toBeLessThan(
        arena.setState.mock.invocationCallOrder[0],
      );

      // Loaded, it runs at once: a callback's fail() mustn't wait.
      gestures.removeGestureDetector(node, 3);
      gestures.setGestureState(node, 3, 3);
      expect(arena.removeDetector).toHaveBeenCalledWith(node, 3);
      expect(arena.setState).toHaveBeenLastCalledWith(node, 3, 3);
      expect(arenas).toHaveLength(1);
    });

    it('commit what callbacks change, as event handlers do', async () => {
      const gestures = await load();
      const { scheduleSettleFlush } = await import('../lynx-element');
      gestures.removeGestureDetector(node, 3);
      await settle();
      expect(arenas[0].afterDispatch).toBe(scheduleSettleFlush);
    });

    it("don't consume: the arena has no native gestures to share with", async () => {
      const gestures = await load();
      gestures.consumeGesture(node, 3, { consume: true });
      expect(globalThis.__ConsumeGesture).not.toHaveBeenCalled();
    });

    it("don't load the arena on the background thread, which runs no Angular", async () => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      const gestures = await load();
      gestures.setGestureDetector(node, 3, 0, config, relations);
      await settle();
      expect(arenas).toEqual([]);
    });
  });
});
