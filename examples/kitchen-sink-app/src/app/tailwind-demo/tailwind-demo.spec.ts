import {
  getQueriesForElement,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { TailwindDemo } from './tailwind-demo';

// This demo frames itself in <app-demo-screen>, whose heading/category/
// description are input()-bound. The shared render() helper's extra appRef.tick()
// trips an Angular 22 zoneless-JIT bug that resets those bound inputs to their
// defaults mid-render, so the header text never reaches the DOM. renderOnce()
// bootstraps with a single tick and avoids it (see src/test-utils/render-once.ts).
//
// The counter is driven by <ui-button (pressed)>. We assert on the counter's
// public API (increment/decrement/resetCount) rather than firing a synthetic tap:
// a `bindEvent:tap` dispatched onto ui-button's container reaches the element, but
// the harness does not propagate the resulting (pressed) output across the nested
// component boundary (no spec in this app taps a ui-button output). The wiring is
// exercised on-device, where ui-button powers every interactive surface here.
let destroyDemo: (() => void) | null = null;

afterEach(() => {
  destroyDemo?.();
  destroyDemo = null;
});

describe('TailwindDemo', () => {
  it('renders the page heading from DemoScreen', async () => {
    const { container, destroy } = await renderOnce(TailwindDemo);
    destroyDemo = destroy;
    expect(container.textContent).toContain('Tailwind');
  });

  it('renders every showcase section title', async () => {
    const { container, destroy } = await renderOnce(TailwindDemo);
    destroyDemo = destroy;
    const { getByText } = getQueriesForElement(container);
    expect(getByText('Colors')).toBeTruthy();
    expect(getByText('Typography')).toBeTruthy();
    expect(getByText('Spacing')).toBeTruthy();
    expect(getByText('Radius')).toBeTruthy();
    expect(getByText('Interactive')).toBeTruthy();
  });

  it('renders the semantic token labels', async () => {
    const { container, destroy } = await renderOnce(TailwindDemo);
    destroyDemo = destroy;
    const { getByText } = getQueriesForElement(container);
    expect(getByText('Primary')).toBeTruthy();
    expect(getByText('Secondary')).toBeTruthy();
    expect(getByText('Muted')).toBeTruthy();
    expect(getByText('Destructive')).toBeTruthy();
  });

  it('renders the interactive button labels', async () => {
    const { container, destroy } = await renderOnce(TailwindDemo);
    destroyDemo = destroy;
    const { getByText } = getQueriesForElement(container);
    expect(getByText('Increment')).toBeTruthy();
    expect(getByText('Decrement')).toBeTruthy();
    expect(getByText('Reset')).toBeTruthy();
  });

  it('starts the counter at 0', async () => {
    const { instance, destroy } = await renderOnce(TailwindDemo);
    destroyDemo = destroy;
    expect(instance.count()).toBe(0);
  });

  it('increment() increases the count by 1', async () => {
    const { instance, destroy } = await renderOnce(TailwindDemo);
    destroyDemo = destroy;

    instance.increment();
    await waitForUpdate();
    expect(instance.count()).toBe(1);
  });

  it('increment() accumulates across calls', async () => {
    const { instance, destroy } = await renderOnce(TailwindDemo);
    destroyDemo = destroy;

    instance.increment();
    instance.increment();
    instance.increment();
    await waitForUpdate();
    expect(instance.count()).toBe(3);
  });

  it('decrement() decreases the count by 1', async () => {
    const { instance, destroy } = await renderOnce(TailwindDemo);
    destroyDemo = destroy;

    instance.decrement();
    await waitForUpdate();
    expect(instance.count()).toBe(-1);
  });

  it('resetCount() returns the count to 0', async () => {
    const { instance, destroy } = await renderOnce(TailwindDemo);
    destroyDemo = destroy;

    instance.increment();
    instance.increment();
    await waitForUpdate();
    expect(instance.count()).toBe(2);

    instance.resetCount();
    await waitForUpdate();
    expect(instance.count()).toBe(0);
  });
});
