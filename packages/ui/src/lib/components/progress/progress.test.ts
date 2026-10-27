import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import { UiProgress } from './progress';

@Component({
  imports: [UiProgress],
  template: `
    <ui-progress
      [value]="value()"
      [max]="max()"
      [indeterminate]="indeterminate()"
      class="h-3"
    />
  `,
})
class ProgressHost {
  readonly value = signal(40);
  readonly max = signal(100);
  readonly indeterminate = signal(false);
}

const renderProgress = async () => {
  const result = await render(ProgressHost);
  return {
    ...result,
    host: result.componentRef.instance as ProgressHost,
    track: () => result.container.querySelector('.bg-muted')!,
    fill: () => result.container.querySelector('.bg-primary')!,
  };
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;

describe('UiProgress', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  it('fills the track by the value out of max', async () => {
    const { fill, track } = await renderProgress();
    expect(fill().getAttribute('style')).toContain('width: 40%');
    expect(track().classList).toContain('h-3');
  });

  it('keeps the fill between 0% and 100%', async () => {
    const { host, fill } = await renderProgress();
    host.value.set(500);
    await waitForUpdate();
    expect(fill().getAttribute('style')).toContain('width: 100%');

    host.value.set(-5);
    await waitForUpdate();
    expect(fill().getAttribute('style')).toContain('width: 0%');

    // A max of 0 would divide by zero.
    host.value.set(50);
    host.max.set(0);
    await waitForUpdate();
    expect(fill().getAttribute('style')).toContain('width: 0%');
  });

  it("doesn't animate the first value, then animates each change", async () => {
    const { host, fill } = await renderProgress();
    expect(animate).not.toHaveBeenCalled();

    host.value.set(80);
    await waitForUpdate();
    expect(animate).toHaveBeenCalledWith(fill(), [
      START,
      expect.any(String),
      [{ width: '40%' }, { width: '80%' }],
      expect.objectContaining({ fill: 'forwards' }),
    ]);
  });

  it('slides a 40% fill across the track while indeterminate', async () => {
    const { host, fill } = await renderProgress();
    host.value.set(60);
    await waitForUpdate();
    animate.mockClear();

    host.indeterminate.set(true);
    await waitForUpdate();
    expect(fill().getAttribute('style')).toContain('width: 40%');
    expect(animate).toHaveBeenCalledWith(fill(), [
      START,
      expect.any(String),
      [
        { transform: 'translateX(-100%)', width: '40%' },
        { transform: 'translateX(250%)', width: '40%' },
      ],
      expect.objectContaining({ iterations: Infinity }),
    ]);
  });

  it("returns to the value without animating when it hasn't changed", async () => {
    const { host, fill } = await renderProgress();
    host.indeterminate.set(true);
    await waitForUpdate();
    animate.mockClear();

    host.indeterminate.set(false);
    await waitForUpdate();
    expect(fill().getAttribute('style')).toContain('width: 40%');
    // Only the sliding animation is canceled; nothing new starts.
    expect(
      animate.mock.calls.map(([, [operation]]) => operation),
    ).not.toContain(START);
  });
});
