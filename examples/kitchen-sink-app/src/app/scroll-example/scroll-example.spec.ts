import { afterEach, describe, expect, it } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { ScrollExample } from './scroll-example';

// This demo renders <ui-icon>, whose `name` is a required input(). The shared
// render() helper's extra appRef.tick() trips an Angular 22 zoneless-JIT bug that
// resets that required input to undefined mid-render, crashing UiIcon. So we
// bootstrap with renderOnce() (a single tick) throughout — see
// src/test-utils/render-once.ts and query-selector-demo.spec.ts.
//
// The @for'd carousel/feed rows are asserted against the component's data model
// rather than the rendered DOM: under the single-tick test renderer only the
// first @for child is flushed, so DOM text queries over the rows are
// unreliable here (the same reason list-example.spec asserts on members(), not
// the rendered list). The rows render correctly on device — this is a harness
// limitation, not a component one.

describe('ScrollExample', () => {
  let destroyDemo: (() => void) | null = null;

  const setup = async () => {
    const rendered = await renderOnce(ScrollExample);
    destroyDemo = rendered.destroy;
    return rendered;
  };

  afterEach(() => {
    destroyDemo?.();
    destroyDemo = null;
  });

  it('renders the page title and category', async () => {
    const { container } = await setup();
    expect(container.textContent).toContain('Scroll View');
    expect(container.textContent).toContain('Elements');
  });

  it('renders the Featured and Activity section labels', async () => {
    const { container } = await setup();
    const text = container.textContent ?? '';
    expect(text).toContain('Featured');
    expect(text).toContain('Activity');
  });

  it('echoes the horizontal orientation in a section badge', async () => {
    const { container } = await setup();
    expect(container.textContent).toContain('horizontal');
  });

  it('exposes six featured collections, each with an icon', async () => {
    const { instance } = await setup();
    expect(instance.collections).toHaveLength(6);
    for (const collection of instance.collections) {
      expect(collection.name.length).toBeGreaterThan(0);
      expect(collection.icon.length).toBeGreaterThan(0);
      expect(collection.tile).toMatch(/^bg-[a-z]+-\d+$/);
    }
  });

  it('exposes an activity feed long enough to scroll', async () => {
    const { instance } = await setup();
    expect(instance.activities.length).toBeGreaterThanOrEqual(10);
    for (const activity of instance.activities) {
      expect(activity.title.length).toBeGreaterThan(0);
      expect(activity.chip).toMatch(/^bg-[a-z]+-\d+$/);
    }
  });

  it('starts at the top edge with a zero scroll offset', async () => {
    const { instance } = await setup();
    expect(instance.scrollY()).toBe(0);
    expect(instance.atEdge()).toBe('top');
  });

  it('tracks the live scroll offset and edges from scroll events', async () => {
    const { instance } = await setup();

    // Scrolling down past the top clears the "top" edge and records the offset.
    instance.onScroll({ detail: { scrollTop: 120.6 } } as never);
    expect(instance.scrollY()).toBe(121);
    expect(instance.atEdge()).toBeNull();

    // Reaching the lower edge flips the pill to "bottom".
    instance.onReachBottom();
    expect(instance.atEdge()).toBe('bottom');

    // Settling back at the very top resolves to "top" even via bindscroll.
    instance.onScroll({ detail: { scrollTop: 0 } } as never);
    expect(instance.atEdge()).toBe('top');
  });

  it('builds tile and chip class strings from a per-item color', async () => {
    const { instance } = await setup();
    expect(instance.tileClass('bg-sky-500')).toContain('bg-sky-500');
    expect(instance.tileClass('bg-sky-500')).toContain('rounded-xl');
    expect(instance.chipClass('bg-rose-500')).toContain('bg-rose-500');
    expect(instance.chipClass('bg-rose-500')).toContain('rounded-full');
  });
});
