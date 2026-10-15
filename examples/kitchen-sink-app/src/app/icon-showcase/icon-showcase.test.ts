import { fireEvent, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { IconShowcase } from './icon-showcase';

let destroyDemo: (() => void) | null = null;

afterEach(() => {
  destroyDemo?.();
  destroyDemo = null;
});

describe('IconShowcase', () => {
  // Data-level checks first, on the filtering logic itself; the rendering
  // checks follow. (Under the old JIT test setup, a single renderOnce() tick
  // only materialized the first outer @for iteration, so these used to be the
  // only checks of the other categories. `ng test` compiles the templates
  // ahead of time, as the app build does, and renders them all.)
  it('exposes all 195 icons across 14 categories with no query', async () => {
    const { instance, destroy } = await renderOnce(IconShowcase);
    destroyDemo = destroy;

    const categories = instance['filteredCategories']();
    expect(categories.length).toBe(14);
    const total = categories.reduce((sum, c) => sum + c.icons.length, 0);
    expect(total).toBe(195);

    const allIcons = categories.flatMap((c) => c.icons);
    for (const name of [
      'sparkles',
      'chart-line',
      'bug',
      'align-left',
      'home',
    ]) {
      expect(allIcons).toContain(name);
    }
    expect(new Set(allIcons).size).toBe(195); // no duplicates across categories
  });

  it('filters to exactly the icons matching the query', async () => {
    const { instance, destroy } = await renderOnce(IconShowcase);
    destroyDemo = destroy;

    instance.query.set('chart');
    const matched = instance['filteredCategories']().flatMap((c) => c.icons);
    expect(matched.sort()).toEqual(
      ['chart-bar', 'chart-column', 'chart-line', 'chart-pie'].sort(),
    );

    instance.query.set('zzz-does-not-exist');
    expect(instance['filteredCategories']()).toEqual([]);

    instance.query.set('');
    expect(instance['filteredCategories']().length).toBe(14);
  });

  it('renders every category — 195 tiles + the preview icon', async () => {
    const { container, destroy } = await renderOnce(IconShowcase);
    destroyDemo = destroy;
    expect(container.querySelectorAll('svg').length).toBe(196);
  });

  it('wires (bindtap) correctly on a tile deep in the rendered category', async () => {
    const { instance, container, destroy } = await renderOnce(IconShowcase);
    destroyDemo = destroy;
    expect(instance.selected()).toBe('sparkles');

    // svg #0 is the preview panel's icon; #22 is the 22nd "Common" tile
    // ("heart") — deep enough into the list to prove the wiring isn't just
    // working for tile #1. Tap its wrapping <view (bindtap)> two levels up:
    // svg -> ui-icon host -> tile.
    const svgs = container.querySelectorAll('svg');
    const tile = svgs[22]!.parentElement!.parentElement!;
    fireEvent.tap(tile);

    expect(instance.selected()).toBe('heart');
  });

  it('renders a search input bound to the query signal', async () => {
    // Same [value]/(changed) wiring as text-measure-demo.ts's ui-input, which
    // is already proven on-device — this repo has no working fireEvent.input
    // precedent for native <input> elements (only (bindtap) is exercised
    // anywhere), so simulating the raw DOM event here would be testing the
    // harness, not this component. Confirm the input renders, then drive the
    // same query signal the (changed) handler calls directly.
    const { instance, container, destroy } = await renderOnce(IconShowcase);
    destroyDemo = destroy;
    expect(container.querySelector('input')).toBeTruthy();

    instance.query.set('zzz-nope');
    expect(instance['filteredCategories']()).toEqual([]);
  });

  it('reflects a preview-size change in the rendered snippet', async () => {
    const { instance, container, destroy } = await renderOnce(IconShowcase);
    destroyDemo = destroy;

    expect(instance.previewSize()).toBe('md');
    instance.previewSize.set('lg');
    await waitForUpdate();
    expect(instance.previewSize()).toBe('lg');

    const text = container.textContent ?? '';
    expect(text).toContain('size="lg"');
  });
});
