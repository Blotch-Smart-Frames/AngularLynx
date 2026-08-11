import {
  fireEvent,
  getQueriesForElement,
} from '@blotch/angular-lynx-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { EventsDemo } from './events-demo';

// This demo renders <ui-icon>, whose `name` is a required input(). The shared
// render() helper's extra appRef.tick() trips an Angular 22 zoneless-JIT bug
// that resets that required input to undefined mid-render, crashing UiIcon.
// renderOnce() bootstraps with a single tick and avoids it (see
// src/test-utils/render-once.ts and app.spec.ts). Signals settle synchronously,
// so assertions read them directly with no waitForUpdate().
let destroyDemo: (() => void) | null = null;

afterEach(() => {
  destroyDemo?.();
  destroyDemo = null;
});

describe('EventsDemo', () => {
  it('renders the event cards', async () => {
    // Assert on titles this component renders itself (via ui-card-title's
    // ng-content). The <app-demo-screen> heading/category are input()-bound and
    // don't bind under the JIT test pipeline — they render only in the AOT app.
    const { container, destroy } = await renderOnce(EventsDemo);
    destroyDemo = destroy;
    const text = container.textContent ?? '';
    expect(text).toContain('Propagation');
    expect(text).toContain('Long press');
    expect(text).toContain('Touch tracking');
  });

  it('starts every counter at zero', async () => {
    const { container, destroy } = await renderOnce(EventsDemo);
    destroyDemo = destroy;
    const text = container.textContent ?? '';
    expect(text).toContain('Taps: 0');
    expect(text).toContain('Outer: 0');
    expect(text).toContain('Long presses: 0');
    expect(text).toContain('x: 0');
  });

  it('increments the tap counter on (bindtap)', async () => {
    const { instance, container, destroy } = await renderOnce(EventsDemo);
    destroyDemo = destroy;
    const { getByText } = getQueriesForElement(container as HTMLElement);

    expect(instance.tapCount()).toBe(0);
    // (bindtap) is on the <view> wrapper; tap the parent of the label text.
    fireEvent.tap(getByText('Tap anywhere in this box').parentElement!);
    expect(instance.tapCount()).toBe(1);
  });

  it('resetTap() returns the tap counter to zero', async () => {
    const { instance, destroy } = await renderOnce(EventsDemo);
    destroyDemo = destroy;

    instance.onTap();
    instance.onTap();
    expect(instance.tapCount()).toBe(2);

    instance.resetTap();
    expect(instance.tapCount()).toBe(0);
  });

  it('tracks propagation counters independently', async () => {
    const { instance, destroy } = await renderOnce(EventsDemo);
    destroyDemo = destroy;

    // A tap on the "Bubbles" child fires its own handler AND bubbles to the
    // outer handler; the "Stops" child (catchtap) only fires its own.
    instance.onBubbleTap();
    instance.onOuterTap();
    instance.onCatchTap();

    expect(instance.bubbleCount()).toBe(1);
    expect(instance.outerCount()).toBe(1);
    expect(instance.catchCount()).toBe(1);

    instance.resetPropagation();
    expect(instance.outerCount()).toBe(0);
    expect(instance.bubbleCount()).toBe(0);
    expect(instance.catchCount()).toBe(0);
  });

  it('separates long press from tap on the same area', async () => {
    const { instance, destroy } = await renderOnce(EventsDemo);
    destroyDemo = destroy;

    instance.onLongPress();
    instance.onLongPressAreaTap();
    instance.onLongPressAreaTap();

    expect(instance.longPressCount()).toBe(1);
    expect(instance.longPressAreaTapCount()).toBe(2);
  });

  it('reads live coordinates and a running delta from the touch stream', async () => {
    const { instance, destroy } = await renderOnce(EventsDemo);
    destroyDemo = destroy;

    // A minimal TouchEvent-shaped payload — the handlers only read touches[0].
    instance.onTouchStart({ touches: [{ clientX: 10, clientY: 20 }] } as never);
    expect(instance.touching()).toBe(true);
    expect(instance.touchX()).toBe(10);
    expect(instance.touchY()).toBe(20);
    expect(instance.touchDeltaX()).toBe(0);

    instance.onTouchMove({ touches: [{ clientX: 35, clientY: 15 }] } as never);
    expect(instance.touchX()).toBe(35);
    expect(instance.touchDeltaX()).toBe(25);
    expect(instance.touchDeltaY()).toBe(-5);

    instance.onTouchEnd();
    expect(instance.touching()).toBe(false);
  });
});
