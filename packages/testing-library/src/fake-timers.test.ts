/**
 * Under `vi.useFakeTimers()`, nothing in a rendered app runs on the real
 * clock: animation frames, and so Angular's change detection, wait for the
 * fake one (see frameOnInstalledTimers in setup.ts).
 */

import { Component, signal } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from './index.js';

@Component({
  selector: 'test-count',
  template: `<text>{{ count() }}</text>`,
})
class Count {
  readonly count = signal(0);
}

/**
 * Lets real time pass, with the event loop free to run real timers meanwhile:
 * a frame on the real clock would fire here. Only the timers are faked, so
 * setImmediate stays real to wait with.
 */
const letRealTimePass = async (ms: number) => {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

afterEach(() => {
  vi.useRealTimers();
});

describe('fake timers', () => {
  it("hold each thread's animation frames until the fake clock moves", () => {
    const env = (globalThis as any).lynxTestingEnv;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onMain = vi.fn();
    const onBackground = vi.fn();
    env.mainThread.globalThis.requestAnimationFrame(onMain);
    env.backgroundThread.globalThis.requestAnimationFrame(onBackground);
    const canceled = vi.fn();
    env.backgroundThread.globalThis.cancelAnimationFrame(
      env.backgroundThread.globalThis.requestAnimationFrame(canceled),
    );
    expect(onMain).not.toHaveBeenCalled();
    expect(onBackground).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    expect(onMain).toHaveBeenCalledTimes(1);
    expect(onBackground).toHaveBeenCalledTimes(1);
    expect(canceled).not.toHaveBeenCalled();
  });

  it('hold change detection until the fake clock moves, however much real time passes', async () => {
    const { container, componentRef } = await render(Count);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    componentRef.instance.count.set(1);
    await letRealTimePass(20);
    expect(container.querySelector('text')!.textContent).toBe('0');

    await vi.advanceTimersByTimeAsync(1);
    expect(container.querySelector('text')!.textContent).toBe('1');
  });
});
