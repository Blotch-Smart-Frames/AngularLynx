// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../../types/lynx';
import { GestureType } from '../types';
import { WebGestureArena } from './arena';

let arena: WebGestureArena;
let afterDispatch: ReturnType<typeof vi.fn<() => void>>;
/**
 * `<label>.<callback>` for each callback, in the order they ran.
 */
let log: string[];
let nextId = 1;
let clock = 0;
let frames: Map<number, FrameRequestCallback>;
let frameId = 0;
/**
 * The page's clock, which the fling's frames go by.
 */
let now = 0;

beforeEach(() => {
  afterDispatch = vi.fn<() => void>();
  arena = new WebGestureArena(afterDispatch);
  log = [];
  clock = 0;
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * On the web, an element's native ref is the DOM element.
 */
const ref = (node: Element) => node as unknown as ElementRef;

/**
 * Runs the fling's next frame, `ms` after the last.
 */
const nextFrame = (ms = 16) => {
  now += ms;
  const due = [...frames.values()];
  frames.clear();
  for (const callback of due) callback(now);
};

const flingToEnd = () => {
  for (let i = 0; i < 5000 && frames.size; i++) nextFrame();
};

const element = (parent: Element = document.body) => {
  const child = document.createElement('x-view');
  parent.append(child);
  return child;
};

type GestureOptions = {
  config?: Record<string, unknown>;
  relations?: Record<string, number[]>;
  callbacks?: string[];
  on?: Record<string, (event: any) => void>;
};

/**
 * Registers a gesture whose callbacks log `<label>.<name>`.
 */
const gesture = (
  node: Element,
  label: string,
  type: GestureType,
  {
    config,
    relations = { waitFor: [], simultaneous: [], continueWith: [] },
    callbacks = ['onBegin', 'onStart', 'onUpdate', 'onEnd'],
    on = {},
  }: GestureOptions = {},
): number => {
  const id = nextId++;
  arena.setDetector(
    ref(node),
    id,
    type,
    {
      callbacks: callbacks.map((name) => ({
        name,
        callback: {
          _fn: (event: unknown) => {
            log.push(`${label}.${name}`);
            on[name]?.(event);
          },
        },
      })),
      config,
    },
    relations,
  );
  return id;
};

type PointerInit = { pointerId?: number; button?: number; dt?: number };

/**
 * A pointer event (jsdom has no PointerEvent), `dt` ms after the last.
 */
const fire = (
  target: EventTarget,
  type: string,
  x: number,
  y = 0,
  { pointerId = 1, button = 0, dt = 16 }: PointerInit = {},
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  });
  clock += dt;
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'timeStamp', { value: clock });
  target.dispatchEvent(event);
  return event;
};

const down = (node: Element, x = 0, y = 0, init?: PointerInit) =>
  fire(node, 'pointerdown', x, y, init);
const move = (x: number, y = 0, init?: PointerInit) =>
  fire(document, 'pointermove', x, y, init);
const up = (x: number, y = 0, init?: PointerInit) =>
  fire(document, 'pointerup', x, y, init);

/**
 * A slow drag (so no fling follows) from `from` to `to` along x.
 */
const drag = (node: Element, from: number, to: number) => {
  down(node, from);
  move((from + to) / 2, 0, { dt: 400 });
  move(to, 0, { dt: 400 });
  up(to, 0, { dt: 400 });
};

const cancelable = (node: Element, type: string, init: EventInit = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true, ...init });
  node.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('WebGestureArena', () => {
  describe('callbacks', () => {
    it("calls them with Lynx's event envelope, and commits after each", () => {
      const tap = element();
      let ended: unknown;
      gesture(tap, 'tap', GestureType.TAP, {
        on: { onEnd: (e) => (ended = e) },
      });

      down(tap, 5, 6);
      up(5, 6);

      expect(log).toEqual(['tap.onBegin', 'tap.onStart', 'tap.onEnd']);
      expect(ended).toEqual({
        type: 'onEnd',
        timestamp: expect.any(Number),
        params: expect.objectContaining({
          type: 'touchend',
          pageX: 5,
          pageY: 6,
          x: 5,
          y: 6,
        }),
      });
      expect(afterDispatch).toHaveBeenCalledTimes(3);
    });

    it("throws a callback's error again once the event is done", () => {
      const tap = element();
      const error = new Error('boom');
      gesture(tap, 'tap', GestureType.TAP, {
        on: {
          onStart: () => {
            throw error;
          },
        },
      });
      const later: (() => void)[] = [];
      vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) =>
        later.push(task),
      );

      down(tap);
      up(0);

      expect(log).toEqual(['tap.onBegin', 'tap.onStart', 'tap.onEnd']);
      expect(later).toHaveLength(1);
      expect(later[0]).toThrow(error);
    });

    it('skips a callback with no function', () => {
      const tap = element();
      arena.setDetector(
        ref(tap),
        nextId++,
        GestureType.TAP,
        { callbacks: [{ name: 'onBegin', callback: {} }] },
        {},
      );
      down(tap);
      up(0);
      expect(afterDispatch).toHaveBeenCalledOnce();
    });

    it('tells every member of the touch about it first, while it has a winner', () => {
      const parent = element();
      const child = element(parent);
      const touches = ['onTouchesDown', 'onTouchesMove', 'onTouchesUp'];
      const parentId = gesture(parent, 'parent', GestureType.TAP, {
        callbacks: touches,
      });
      gesture(child, 'child', GestureType.TAP, {
        callbacks: [...touches, 'onStart'],
      });

      down(child);
      up(0);
      // Innermost first, as the touch bubbles.
      expect(log).toEqual([
        'child.onTouchesDown',
        'parent.onTouchesDown',
        'child.onTouchesUp',
        'parent.onTouchesUp',
        'child.onStart',
      ]);

      // Ended from code, the touch has no winner left to tell once the arena
      // has seen it, which it does after telling the members of the move.
      log = [];
      down(child);
      arena.setState(ref(parent), parentId, 3);
      arena.setState(ref(child), nextId - 1, 3);
      move(1, 0, { dt: 400 });
      move(2, 0, { dt: 400 });
      expect(log).toEqual([
        'child.onTouchesDown',
        'parent.onTouchesDown',
        'child.onTouchesMove',
        'parent.onTouchesMove',
      ]);
      up(2);
    });
  });

  describe('following the pointer', () => {
    it('follows a pan off its element, until it lifts', () => {
      const pan = element();
      let updated: any;
      gesture(pan, 'pan', GestureType.PAN, {
        on: { onUpdate: (e) => (updated = e) },
      });

      down(pan, 10, 10);
      move(150, 40);
      expect(updated.params).toMatchObject({ pageX: 150, pageY: 40 });
      up(150, 40, { dt: 400 });
      expect(log).toEqual([
        'pan.onBegin',
        'pan.onStart',
        'pan.onUpdate',
        'pan.onEnd',
      ]);

      move(200);
      expect(log).toHaveLength(4);
    });

    it("follows one pointer, and a mouse's main button only", () => {
      const tap = element();
      const other = element();
      gesture(tap, 'tap', GestureType.TAP);
      gesture(other, 'other', GestureType.TAP);

      down(tap, 0, 0, { button: 2 });
      expect(log).toEqual([]);

      down(tap);
      down(other, 0, 0, { pointerId: 2 });
      move(50, 0, { pointerId: 2 });
      up(50, 0, { pointerId: 2 });
      up(0);
      expect(log).toEqual(['tap.onBegin', 'tap.onStart', 'tap.onEnd']);
    });

    it('fails a tap whose touch the browser cancels, with no fling after', () => {
      const tap = element();
      gesture(tap, 'tap', GestureType.TAP);
      gesture(tap, 'fling', GestureType.FLING);
      down(tap);
      move(5);
      fire(document, 'pointercancel', 30);
      // Lynx calls a failed tap's onEnd too (LynxGestureDetector drops it).
      expect(log).toEqual(['tap.onBegin', 'tap.onEnd']);
      expect(frames.size).toBe(0);
    });
  });

  describe('gestures on one element', () => {
    it('race: the first to activate fails the others', () => {
      const area = element();
      gesture(area, 'pan', GestureType.PAN, { config: { minDistance: 10 } });
      gesture(area, 'tap', GestureType.TAP, {
        config: { maxDuration: 500, maxDistance: 50 },
      });

      drag(area, 0, 30);

      expect(log).toEqual([
        'pan.onBegin',
        'tap.onBegin',
        'pan.onStart',
        'pan.onUpdate',
        'tap.onEnd',
        'pan.onUpdate',
        'pan.onEnd',
      ]);
    });

    it('tap: the pan ends first, then the tap is recognized', () => {
      const area = element();
      const panId = gesture(area, 'pan', GestureType.PAN, {
        config: { minDistance: 10 },
      });
      gesture(area, 'tap', GestureType.TAP, {
        relations: { waitFor: [panId], simultaneous: [], continueWith: [] },
      });

      down(area);
      up(0);

      expect(log).toEqual([
        'pan.onBegin',
        'tap.onBegin',
        'pan.onEnd',
        'tap.onStart',
        'tap.onEnd',
      ]);
    });

    it("don't fail the gestures they're simultaneous with", () => {
      vi.useFakeTimers();
      const area = element();
      const panId = nextId;
      const pressId = nextId + 1;
      gesture(area, 'pan', GestureType.PAN, {
        relations: { waitFor: [], simultaneous: [pressId], continueWith: [] },
      });
      gesture(area, 'press', GestureType.LONGPRESS, {
        config: { minDuration: 500, maxDistance: 100 },
        relations: { waitFor: [], simultaneous: [panId], continueWith: [] },
      });

      down(area);
      move(20);
      move(30);
      vi.advanceTimersByTime(500);

      expect(log).toContain('press.onStart');
      expect(log).not.toContain('press.onEnd');
      up(30);
    });
  });

  describe('members', () => {
    it('hand the touch to the next member once the winner fails', () => {
      const parent = element();
      const child = element(parent);
      gesture(parent, 'parent', GestureType.PAN);
      gesture(child, 'child', GestureType.TAP);

      down(child);
      move(20);
      expect(log).toEqual(['child.onBegin', 'child.onEnd']);
      move(25);
      expect(log.slice(2)).toEqual([
        'parent.onBegin',
        'parent.onStart',
        'parent.onUpdate',
      ]);
      up(25, 0, { dt: 400 });
    });

    it('go back and forth between members that both fail, resetting each, as iOS does', () => {
      const parent = element();
      const child = element(parent);
      gesture(parent, 'parent', GestureType.TAP);
      gesture(child, 'child', GestureType.TAP);

      down(child);
      for (const x of [20, 25, 30, 35]) move(x, 0, { dt: 400 });
      up(35, 0, { dt: 400 });

      // Each move fails one tap, which hands the touch to the other with its
      // gestures reset (reCompeteByGestures). The parent's, reset by the last
      // move, then sees only the touch lift, which recognizes a tap.
      expect(log.filter((entry) => entry.endsWith('onStart'))).toEqual([
        'parent.onStart',
      ]);
    });

    it('put an ancestor a member waits for ahead of it', () => {
      const parent = element();
      const child = element(parent);
      const parentTap = gesture(parent, 'parent', GestureType.TAP);
      gesture(child, 'child', GestureType.TAP, {
        relations: {
          waitFor: [parentTap],
          simultaneous: [],
          continueWith: [],
        },
      });

      down(child);
      up(0);

      expect(log).toEqual(['parent.onBegin', 'parent.onStart', 'parent.onEnd']);
    });

    it('follow the continueWith members only', () => {
      const grandparent = element();
      const parent = element(grandparent);
      const child = element(parent);
      const gpPan = gesture(grandparent, 'grandparent', GestureType.PAN);
      gesture(parent, 'parent', GestureType.PAN);
      gesture(child, 'child', GestureType.TAP, {
        relations: { waitFor: [], simultaneous: [], continueWith: [gpPan] },
      });

      down(child);
      move(20);
      move(25);

      expect(log).toContain('grandparent.onStart');
      expect(log).not.toContain('parent.onBegin');
      up(25, 0, { dt: 400 });
    });

    it("keep a gesture's relations only when it waits for a member of the touch", () => {
      const grandparent = element();
      const parent = element(grandparent);
      const child = element(parent);
      const gpPan = gesture(grandparent, 'grandparent', GestureType.PAN);
      gesture(parent, 'parent', GestureType.PAN);
      // Two gestures: Lynx reads the relations of the first, by ID, with any.
      gesture(child, 'child', GestureType.TAP, {
        relations: { waitFor: [9999], simultaneous: [], continueWith: [gpPan] },
      });
      gesture(child, 'other', GestureType.LONGPRESS, {
        relations: { waitFor: [], simultaneous: [], continueWith: [gpPan] },
      });

      down(child);
      move(20);
      move(25);

      expect(log).toContain('parent.onStart');
      expect(log).not.toContain('grandparent.onBegin');
      up(25, 0, { dt: 400 });
    });

    it("ignore a simultaneous gesture that isn't bound to any element", () => {
      const pan = element();
      gesture(pan, 'pan', GestureType.PAN, {
        relations: { waitFor: [], simultaneous: [9999], continueWith: [] },
      });
      drag(pan, 0, 20);
      expect(log).toEqual([
        'pan.onBegin',
        'pan.onStart',
        'pan.onUpdate',
        'pan.onUpdate',
        'pan.onEnd',
      ]);
    });

    it('let members simultaneous with the winner have the touch too', () => {
      const parent = element();
      const child = element(parent);
      const parentPan = gesture(parent, 'parent', GestureType.PAN);
      gesture(child, 'child', GestureType.PAN, {
        relations: {
          waitFor: [],
          simultaneous: [parentPan],
          continueWith: [],
        },
      });

      down(child);
      move(20);

      expect(log).toEqual([
        'child.onBegin',
        'parent.onBegin',
        'child.onStart',
        'child.onUpdate',
        'parent.onStart',
        'parent.onUpdate',
      ]);
      up(20, 0, { dt: 400 });
    });
  });

  describe('state from code', () => {
    it('fails a gesture at once, which takes the touch back on the move after next, as on iOS', () => {
      const pan = element();
      let failed = false;
      const id = gesture(pan, 'pan', GestureType.PAN, {
        on: {
          onUpdate: () => {
            if (failed) return;
            failed = true;
            arena.setState(ref(pan), id, 2);
          },
        },
      });

      down(pan);
      move(10);
      expect(log).toEqual([
        'pan.onBegin',
        'pan.onStart',
        'pan.onUpdate',
        'pan.onEnd',
      ]);
      move(20);
      expect(log).toHaveLength(4);
      move(30);
      expect(log.slice(4)).toEqual([
        'pan.onBegin',
        'pan.onStart',
        'pan.onUpdate',
      ]);
      up(30, 0, { dt: 400 });
    });

    it('ends a gesture, after which the touch has no winner', () => {
      const pan = element();
      const id = gesture(pan, 'pan', GestureType.PAN, {
        on: { onStart: () => arena.setState(ref(pan), id, 3) },
      });

      down(pan);
      move(10);
      move(20);
      up(20, 0, { dt: 400 });

      expect(log).toEqual(['pan.onBegin', 'pan.onStart', 'pan.onEnd']);
    });

    it('ignores activating, as iOS does, and gestures it has no handler for yet', () => {
      const tap = element();
      const id = gesture(tap, 'tap', GestureType.TAP);
      arena.setState(ref(tap), id, 2);
      arena.setState(ref(element()), id, 2);
      down(tap);
      arena.setState(ref(tap), id, 1);
      arena.setState(ref(tap), 9999, 2);
      up(0);
      expect(log).toEqual(['tap.onBegin', 'tap.onStart', 'tap.onEnd']);
    });
  });

  describe('registration', () => {
    it('replaces a gesture set again with the same ID', () => {
      const tap = element();
      const id = gesture(tap, 'first', GestureType.TAP);
      arena.setDetector(
        ref(tap),
        id,
        GestureType.TAP,
        {
          callbacks: [
            {
              name: 'onEnd',
              callback: { _fn: () => log.push('second.onEnd') },
            },
          ],
        },
        {},
      );
      down(tap);
      up(0);
      expect(log).toEqual(['second.onEnd']);
    });

    it('stops following an element once its last gesture is removed', () => {
      const tap = element();
      const first = gesture(tap, 'first', GestureType.TAP);
      const second = gesture(tap, 'second', GestureType.LONGPRESS);
      arena.removeDetector(ref(tap), first);
      arena.removeDetector(ref(tap), first);
      arena.removeDetector(ref(element()), second);

      down(tap);
      up(0);
      expect(log).toEqual(['second.onBegin', 'second.onEnd']);

      log = [];
      arena.removeDetector(ref(tap), second);
      down(tap);
      up(0);
      expect(log).toEqual([]);
      expect(cancelable(tap, 'touchmove')).toBe(false);
    });

    it('keeps a gesture bound to two elements on the other when removed from one', () => {
      const first = element();
      const second = element();
      const id = gesture(first, 'shared', GestureType.TAP);
      arena.setDetector(
        ref(second),
        id,
        GestureType.TAP,
        {
          callbacks: [
            {
              name: 'onStart',
              callback: { _fn: () => log.push('second.onStart') },
            },
          ],
        },
        {},
      );
      arena.removeDetector(ref(first), id);
      down(second);
      up(0);
      expect(log).toEqual(['second.onStart']);
    });

    it("starts a member's gestures over when they change, stopping their timers", () => {
      vi.useFakeTimers();
      const tap = element();
      gesture(tap, 'tap', GestureType.TAP);
      down(tap);
      gesture(tap, 'pan', GestureType.PAN);
      vi.advanceTimersByTime(1000);
      expect(log).toEqual(['tap.onBegin']);
      up(0);
    });

    it("hands the touch on when a member's gestures are all removed during it", () => {
      const parent = element();
      const child = element(parent);
      gesture(parent, 'parent', GestureType.PAN);
      const childTap = gesture(child, 'child', GestureType.TAP);

      down(child);
      arena.removeDetector(ref(child), childTap);
      move(20);
      move(25);
      move(30);
      expect(log).toContain('parent.onUpdate');
      up(30, 0, { dt: 400 });
    });

    it("doesn't take the touch back for a member with no gestures left", () => {
      const pan = element();
      const id = gesture(pan, 'pan', GestureType.PAN, {
        on: { onStart: () => arena.removeDetector(ref(pan), id) },
      });
      down(pan);
      move(10);
      move(20);
      move(30);
      up(30, 0, { dt: 400 });
      // The move that removed it still updates it, as its handler was going.
      expect(log).toEqual(['pan.onBegin', 'pan.onStart', 'pan.onUpdate']);
    });
  });

  describe('the browser', () => {
    it("can't scroll, select or drag out while a pan is in play", () => {
      const pan = element();
      const tap = element();
      gesture(pan, 'pan', GestureType.PAN);
      gesture(tap, 'tap', GestureType.TAP);

      expect(cancelable(pan, 'touchmove')).toBe(false);
      down(pan);
      expect(cancelable(pan, 'touchmove')).toBe(true);
      expect(cancelable(pan, 'touchmove', { cancelable: false })).toBe(false);
      expect(cancelable(pan, 'selectstart')).toBe(true);
      expect(cancelable(pan, 'dragstart')).toBe(true);
      up(0);
      expect(cancelable(pan, 'selectstart')).toBe(false);

      // A tap doesn't stop the browser.
      down(tap);
      expect(cancelable(tap, 'touchmove')).toBe(false);
      expect(cancelable(tap, 'dragstart')).toBe(false);
      up(0);
    });
  });

  describe('flings', () => {
    const panAndFling = () => {
      const area = element();
      const panId = nextId;
      const flingId = nextId + 1;
      gesture(area, 'pan', GestureType.PAN, {
        relations: { waitFor: [], simultaneous: [flingId], continueWith: [] },
      });
      const deltas: number[] = [];
      gesture(area, 'fling', GestureType.FLING, {
        relations: { waitFor: [], simultaneous: [panId], continueWith: [] },
        on: { onUpdate: (e) => deltas.push(e.params.deltaX) },
      });
      return { area, panId, flingId, deltas };
    };

    const swipe = (area: Element) => {
      down(area);
      for (let x = 20; x <= 100; x += 20) move(x);
      up(100);
    };

    it('follow a quick release, with each frame’s step, until the momentum runs out', () => {
      const { area, deltas } = panAndFling();
      swipe(area);
      expect(log.filter((entry) => entry.startsWith('fling'))).toEqual([
        'fling.onBegin',
      ]);
      flingToEnd();
      expect(log.at(-1)).toBe('fling.onEnd');
      expect(deltas.length).toBeGreaterThan(10);
      // Lynx's steps are scroll-like: against the swipe.
      expect(Math.min(...deltas)).toBeLessThan(0);
      expect(Math.max(...deltas)).toBeLessThanOrEqual(0);
    });

    it('end at once after a slow release', () => {
      const { area } = panAndFling();
      drag(area, 0, 50);
      expect(log.filter((entry) => entry.startsWith('fling'))).toEqual([
        'fling.onBegin',
        'fling.onEnd',
      ]);
      expect(frames.size).toBe(0);
    });

    it('stop when a new touch starts', () => {
      const { area } = panAndFling();
      swipe(area);
      nextFrame();
      expect(frames.size).toBe(1);
      down(area);
      expect(frames.size).toBe(0);
      up(0);
    });

    it('stop once the flinging member has no gestures left', () => {
      const { area, panId, flingId } = panAndFling();
      swipe(area);
      nextFrame();
      arena.removeDetector(ref(area), panId);
      arena.removeDetector(ref(area), flingId);
      nextFrame();
      expect(frames.size).toBe(0);
    });

    it("run on a member without a fling, which ignores them, and the tap's chain after", () => {
      const parent = element();
      const child = element(parent);
      gesture(parent, 'parent', GestureType.PAN);
      gesture(child, 'child', GestureType.TAP, {
        config: { maxDuration: 500, maxDistance: 50 },
      });

      down(child);
      move(20);
      up(40);
      expect(log).toEqual(['child.onBegin', 'child.onStart', 'child.onEnd']);
      flingToEnd();
      expect(frames.size).toBe(0);

      // A slow tap hands the touch to the parent as it ends, which runs the
      // fling's end there too.
      log = [];
      down(child);
      up(0, 0, { dt: 400 });
      expect(log).toEqual(['child.onBegin', 'child.onStart', 'child.onEnd']);
    });
  });
});
