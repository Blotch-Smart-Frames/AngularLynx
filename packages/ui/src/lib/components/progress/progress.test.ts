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

/**
 * The CSS a component brings, which the build adds to the app's.
 */
const componentStyles = (component: unknown): string =>
  (component as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');

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

  // A class on a component lands on its host too (issue #181): the host is
  // the track, so its height is set once.
  it('puts its class on one element, the track', async () => {
    const { container, track } = await renderProgress();
    expect([...container.querySelectorAll('.h-3')]).toEqual([track()]);
  });

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

  // Core Animation and Android's animators slide it, so it keeps moving
  // while Angular builds a screen, which is when the bar shows. Lynx's own
  // animator ticks on Angular's thread, and stood still meanwhile.
  it("slides a 40% fill across the track on the platform's animator while indeterminate", async () => {
    const { host, container, fill } = await renderProgress();
    host.value.set(60);
    await waitForUpdate();
    animate.mockClear();

    host.indeterminate.set(true);
    await waitForUpdate();
    // Still one fill, with the same classes.
    expect(container.querySelectorAll('.bg-primary')).toHaveLength(1);
    expect([...fill().classList].sort()).toEqual([
      'bg-primary',
      'h-full',
      'rounded-full',
    ]);
    expect(fill().getAttribute('enable-new-animator')).toBe('false');
    // Android moves only a view of its own.
    expect(fill().getAttribute('flatten')).toBe('false');
    const { style } = fill() as HTMLElement;
    expect(style.width).toBe('40%');
    expect(style.animationName).toBe('ui-progress-slide');
    expect(style.animationDuration).toBe('1200ms');
    expect(style.animationTimingFunction).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
    expect(style.animationIterationCount).toBe('infinite');
    // animate() does nothing on an element the platform animates. (The
    // value's width animation is canceled with the fill that left.)
    expect(
      animate.mock.calls.map(([, [operation]]) => operation),
    ).not.toContain(START);
  });

  it('slides the fill from just off the left of the track to just past its right', () => {
    // Only the transform moves: a width among the keyframes, even an
    // unchanging one, has Lynx lay the page out again on every frame. A
    // translateX percentage is of the 40% fill's own width.
    expect(componentStyles(UiProgress)).toMatch(
      /@keyframes ui-progress-slide\s*\{\s*from\s*\{\s*transform:\s*translateX\(-100%\);?\s*\}\s*to\s*\{\s*transform:\s*translateX\(250%\);?\s*\}/,
    );
  });

  it("returns to the value without animating when it hasn't changed", async () => {
    const { host, fill } = await renderProgress();
    host.indeterminate.set(true);
    await waitForUpdate();
    animate.mockClear();

    host.indeterminate.set(false);
    await waitForUpdate();
    expect(fill().getAttribute('style')).toBe('width: 40%;');
    // Back on Lynx's animator, which animates its width as the value changes.
    expect(fill().hasAttribute('enable-new-animator')).toBe(false);
    expect(animate).not.toHaveBeenCalled();
  });

  // A fill of its own for each mode: the one that comes back is made at the
  // value's width, and native Lynx drops an animation on an element it
  // hasn't drawn yet.
  it('comes back at a value set while indeterminate, then animates each change', async () => {
    const { host, fill } = await renderProgress();
    host.indeterminate.set(true);
    await waitForUpdate();
    host.value.set(80);
    await waitForUpdate();
    animate.mockClear();

    host.indeterminate.set(false);
    await waitForUpdate();
    expect(fill().getAttribute('style')).toBe('width: 80%;');
    expect(animate).not.toHaveBeenCalled();

    host.value.set(90);
    await waitForUpdate();
    expect(animate).toHaveBeenCalledWith(fill(), [
      START,
      expect.any(String),
      [{ width: '80%' }, { width: '90%' }],
      expect.objectContaining({ fill: 'forwards' }),
    ]);
  });
});
