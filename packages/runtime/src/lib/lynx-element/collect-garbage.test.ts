import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CollectGarbage from './collect-garbage';

/**
 * The module, loaded fresh on the main thread of a Lynx whose background
 * thread hears each relayed call as an event (see callOnBackground).
 */
const load = async (
  opts: { mainThread?: boolean; reachable?: boolean } = {},
): Promise<typeof CollectGarbage> => {
  vi.resetModules();
  vi.stubGlobal('__MAIN_THREAD__', opts.mainThread ?? true);
  vi.stubGlobal('lynx', {
    getJSContext: () => ({
      addEventListener: () => {},
      dispatchEvent: (event: { type: string; data: string }) => {
        calls.push(JSON.parse(event.data));
        if (opts.reachable === false) throw new Error('no background thread');
      },
    }),
  });
  return import('./collect-garbage');
};

/**
 * What the main thread sent, or tried to send, the background thread to run.
 */
let calls: { name: string; args: unknown[] }[];

const collections = (): number =>
  calls.filter(
    (call) =>
      call.name === 'callModule' &&
      JSON.stringify(call.args) ===
        JSON.stringify(['native', 'AngularLynxShell', 'collectGarbage', []]),
  ).length;

/**
 * Releases `count` elements in one commit, as LynxElement does.
 */
const release = (module: typeof CollectGarbage, count: number): void => {
  for (let i = 0; i < count; i++) module.noteReleased();
  module.scheduleCollection();
};

describe('scheduleCollection()', () => {
  beforeEach(() => {
    calls = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks the shell for a collection once a screen's worth of elements is released and the app has settled", async () => {
    const module = await load();

    release(module, module.RELEASES_PER_COLLECTION);
    await vi.advanceTimersByTimeAsync(module.QUIET_MS - 1);
    expect(collections()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(collections()).toBe(1);
  });

  it('counts the elements of several commits together', async () => {
    const module = await load();

    release(module, module.RELEASES_PER_COLLECTION - 1);
    await vi.advanceTimersByTimeAsync(module.MAX_WAIT_MS);
    expect(collections()).toBe(0);
    release(module, 1);
    await vi.advanceTimersByTimeAsync(module.QUIET_MS);

    expect(collections()).toBe(1);
  });

  it('waits until the app stops releasing elements', async () => {
    const module = await load();

    release(module, module.RELEASES_PER_COLLECTION);
    await vi.advanceTimersByTimeAsync(module.QUIET_MS - 100);
    release(module, 1);
    await vi.advanceTimersByTimeAsync(module.QUIET_MS - 1);
    expect(collections()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(collections()).toBe(1);
  });

  it("isn't put off by commits that release nothing", async () => {
    const module = await load();

    release(module, module.RELEASES_PER_COLLECTION);
    await vi.advanceTimersByTimeAsync(module.QUIET_MS - 100);
    module.scheduleCollection();
    await vi.advanceTimersByTimeAsync(100);

    expect(collections()).toBe(1);
  });

  it("doesn't wait longer than MAX_WAIT_MS for an app that keeps releasing elements", async () => {
    const module = await load();

    release(module, module.RELEASES_PER_COLLECTION);
    for (let t = 0; t < module.MAX_WAIT_MS; t += module.QUIET_MS / 2) {
      expect(collections()).toBe(0);
      await vi.advanceTimersByTimeAsync(module.QUIET_MS / 2);
      release(module, 1);
    }

    expect(collections()).toBe(1);
  });

  it('asks at most once every MIN_INTERVAL_MS', async () => {
    const module = await load();
    release(module, module.RELEASES_PER_COLLECTION);
    await vi.advanceTimersByTimeAsync(module.QUIET_MS);
    expect(collections()).toBe(1);

    // Released as the first collection runs: the next is due MIN_INTERVAL_MS
    // after it, not QUIET_MS after this.
    release(module, module.RELEASES_PER_COLLECTION);
    await vi.advanceTimersByTimeAsync(module.MIN_INTERVAL_MS - 1);
    expect(collections()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(collections()).toBe(2);
  });

  it('starts counting again after a collection', async () => {
    const module = await load();
    release(module, module.RELEASES_PER_COLLECTION);
    await vi.advanceTimersByTimeAsync(module.QUIET_MS);

    release(module, module.RELEASES_PER_COLLECTION - 1);
    await vi.advanceTimersByTimeAsync(module.MIN_INTERVAL_MS * 2);

    expect(collections()).toBe(1);
  });

  it('never asks a host that turned the first request down again', async () => {
    const module = await load({ reachable: false });
    release(module, module.RELEASES_PER_COLLECTION);
    await vi.advanceTimersByTimeAsync(module.QUIET_MS);
    expect(collections()).toBe(1);

    release(module, module.RELEASES_PER_COLLECTION);
    await vi.advanceTimersByTimeAsync(module.MIN_INTERVAL_MS * 2);

    expect(vi.getTimerCount()).toBe(0);
    expect(collections()).toBe(1);
  });

  it('asks nothing off the main thread', async () => {
    const module = await load({ mainThread: false });

    release(module, module.RELEASES_PER_COLLECTION);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks nothing under the testing library, which has no shell', async () => {
    const module = await load();
    vi.stubGlobal('lynxTestingEnv', {});

    release(module, module.RELEASES_PER_COLLECTION);

    expect(vi.getTimerCount()).toBe(0);
  });
});
