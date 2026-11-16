import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';

/**
 * How the lists changed since the last flush reach native: each sends its
 * update-list-info, and one flush lays them all out, as React Lynx sends a
 * commit's lists before its one flush. Each list used to flush on its own.
 *
 * Every test loads the modules afresh: the first render's latch
 * (lynx-render-lifecycle.ts) and the pending lists are module state, and
 * some tests need the first render still under way.
 */

let uid = 0;
const makeRef = (): ElementRef => ({ __uid: ++uid }) as ElementRef;

/**
 * Every update-list-info and flush native was sent, in order.
 */
let calls: string[] = [];

const setupGlobals = () => {
  calls = [];
  globalThis.__SetAttribute = vi.fn((_ref: unknown, name: string) => {
    if (name === 'update-list-info') calls.push('list');
  });
  globalThis.__GetAttributeByName = vi.fn(() => null);
  globalThis.__GetElementUniqueID = vi.fn(
    (ref: { __uid?: number }) => ref.__uid!,
  );
  globalThis.__FlushElementTree = vi.fn((_element?: unknown, options?: any) => {
    calls.push(options?.triggerLayout ? 'flush with layout' : 'flush');
  }) as typeof __FlushElementTree;
};

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(() => resolve()));

/**
 * The modules, loaded afresh, and lists to change.
 */
const load = async ({ firstRender = 'done' } = {}) => {
  vi.resetModules();
  const updates = await import('./list-updates');
  const { LynxListElement } = await import('./lynx-list-element');
  const { LynxElement } = await import('./lynx-element');
  const lifecycle = await import('../lynx-render-lifecycle');
  if (firstRender === 'done') lifecycle.markFirstRenderComplete();
  const list = () => new LynxListElement(makeRef());
  const item = () => new LynxElement(makeRef());
  /**
   * An anchor comment, which native isn't told about.
   */
  const anchor = () => {
    const comment = new LynxElement(makeRef());
    comment.tagName = 'comment';
    return comment;
  };
  return { ...updates, lifecycle, list, item, anchor };
};

describe('list updates', () => {
  beforeEach(setupGlobals);
  afterEach(flushMicrotasks);

  it('sends every pending list, and says whether any was sent, without flushing', async () => {
    const { processPendingListUpdates, list, item, anchor } = await load();
    const a = list();
    const b = list();
    a.appendChild(item());
    b.appendChild(item());

    expect(processPendingListUpdates()).toBe(true);
    expect(calls).toEqual(['list', 'list']);

    // A change native isn't told about.
    a.appendChild(anchor());
    expect(processPendingListUpdates()).toBe(false);
    expect(calls).toEqual(['list', 'list']);
  });

  it('flushes once for every list changed, after sending them all', async () => {
    const { flushTreeWithListUpdates, list, item, anchor } = await load();
    for (const each of [list(), list(), list()]) each.appendChild(item());

    flushTreeWithListUpdates();

    expect(calls).toEqual(['list', 'list', 'list', 'flush with layout']);
    expect(globalThis.__FlushElementTree).toHaveBeenCalledExactlyOnceWith(
      undefined,
      { triggerLayout: true },
    );

    // With no list to send, the tree's flush as it always was.
    flushTreeWithListUpdates();
    list().appendChild(anchor());
    flushTreeWithListUpdates();
    expect(calls.slice(4)).toEqual(['flush', 'flush']);
    expect(globalThis.__FlushElementTree).toHaveBeenLastCalledWith();
  });

  it('lays out lists changed outside a change detection cycle with one flush', async () => {
    // A lazy route's component creates its static items before its first
    // check, outside a cycle, and no settle flush is coming.
    const { list, item, anchor } = await load();
    list().appendChild(item());
    list().appendChild(item());
    expect(calls).toEqual([]);

    await flushMicrotasks();

    expect(calls).toEqual(['list', 'list', 'flush with layout']);

    // No flush when no list has anything to send.
    list().appendChild(anchor());
    await flushMicrotasks();
    expect(calls).toHaveLength(3);
  });

  it('leaves lists to a flush that already sent them', async () => {
    const { flushTreeWithListUpdates, list, item } = await load();
    list().appendChild(item());

    // end() or a settle flush, before the microtask runs.
    flushTreeWithListUpdates();
    await flushMicrotasks();

    expect(calls).toEqual(['list', 'flush with layout']);
  });

  it('forgets a list that goes before its update', async () => {
    const { flushTreeWithListUpdates, list, item } = await load();
    const gone = list();
    gone.appendChild(item());
    list().appendChild(item());

    gone.remove();
    flushTreeWithListUpdates();

    expect(calls).toEqual(['list', 'flush with layout']);
  });

  it('waits for the first render, then sends every list it changed with one flush', async () => {
    vi.useFakeTimers();
    try {
      const {
        flushTreeWithListUpdates,
        lifecycle,
        list,
        item,
        processPendingListUpdates,
      } = await load({ firstRender: 'pending' });
      const a = list();
      const b = list();
      const gone = list();
      // The first render's cycles: their end() hands its lists over, and
      // native flushes after renderPage, not end().
      a.appendChild(item());
      gone.appendChild(item());
      expect(processPendingListUpdates()).toBe(false);
      b.appendChild(item());
      a.appendChild(item());
      expect(processPendingListUpdates()).toBe(false);
      // Removed before then: nothing is sent to it.
      gone.remove();
      // The safety net's microtask hands them over too.
      list().appendChild(item());
      await flushMicrotasks();
      expect(calls).toEqual([]);

      lifecycle.markFirstRenderComplete();
      // On a task of its own, after native's renderPage() has returned.
      expect(calls).toEqual([]);
      await vi.runAllTimersAsync();

      expect(calls).toEqual(['list', 'list', 'list', 'flush with layout']);

      // Each list was sent all of its items.
      a.appendChild(item());
      flushTreeWithListUpdates();
      const infos = vi
        .mocked(globalThis.__SetAttribute)
        .mock.calls.filter(([, name]) => name === 'update-list-info')
        .map(([, , info]) => info as { insertAction: unknown[] });
      expect(infos.map((info) => info.insertAction.length)).toEqual([
        2, 1, 1, 1,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
