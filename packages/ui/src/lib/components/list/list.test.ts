import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { lynxMainThread } from '../../../test-utils/lynx-main-thread';
import { UiList } from './list';

@Component({
  imports: [UiList, LYNX_ELEMENTS],
  template: `
    <ui-list
      [height]="height()"
      [mainAxisGap]="mainAxisGap()"
      [crossAxisGap]="crossAxisGap()"
      [bounces]="bounces()"
      [scrollBar]="scrollBar()"
      [nestedScroll]="nestedScroll()"
      [sticky]="sticky()"
      class="bg-card"
      (scrolledToStart)="reached.push('start')"
      (scrolledToEnd)="reached.push('end')"
    >
      <text>Item</text>
    </ui-list>
  `,
})
class ListHost {
  readonly height = signal('');
  readonly mainAxisGap = signal('');
  readonly crossAxisGap = signal('');
  readonly bounces = signal(true);
  readonly scrollBar = signal(true);
  readonly nestedScroll = signal(false);
  readonly sticky = signal(false);
  readonly reached: string[] = [];
}

const renderList = async () => {
  const result = await render(ListHost);
  return {
    ...result,
    host: result.componentRef.instance as ListHost,
    list: () => result.container.querySelector('list')!,
    /** The list's box, its host, which the <list> fills. */
    box: () => result.container.querySelector('list')!.parentElement!,
  };
};

/**
 * The values each boolean reached Lynx with, through `__SetAttribute`.
 */
const watchAttributes = () => {
  const setAttribute = vi.spyOn(lynxMainThread(), '__SetAttribute');
  return {
    last: (name: string): unknown =>
      setAttribute.mock.calls.filter((call) => call[1] === name).at(-1)?.[2],
    restore: () => setAttribute.mockRestore(),
  };
};

describe('UiList', () => {
  it('renders a single-column vertical list with the given class', async () => {
    // Lynx `<list>` is virtualized: items join the native tree only through
    // its componentAtIndex callback, which a unit test doesn't drive. So this
    // checks the list itself rather than the projected item.
    const { list, box } = await renderList();
    expect(list().getAttribute('list-type')).toBe('single');
    expect(list().getAttribute('span-count')).toBe('1');
    expect(list().getAttribute('scroll-orientation')).toBe('vertical');
    expect(list().classList).toContain('grow');
    expect(box().classList).toContain('w-full');
    expect(box().classList).toContain('bg-card');
  });

  // Angular gives a component's host every static attribute written on it,
  // so the <list> taking the class as well applied it twice (issue #181).
  it('puts its class on one element, its box', async () => {
    const { container, box } = await renderList();
    expect([...container.querySelectorAll('.bg-card')]).toEqual([box()]);
  });

  it('gives the list an explicit height, which it needs to scroll', async () => {
    const { host, list } = await renderList();
    expect(list().getAttribute('style') ?? '').not.toContain('height');

    host.height.set('400px');
    await waitForUpdate();
    expect(list().getAttribute('style')).toContain('height: 400px');
  });

  it('sets the gaps as list styles, which Lynx reads, not attributes', async () => {
    // jsdom drops style properties it doesn't know, so the gaps never show in
    // the style attribute: watch what reaches Lynx's inline style API instead.
    const addInlineStyle = vi.spyOn(lynxMainThread(), '__AddInlineStyle');
    const { host, list } = await renderList();
    host.mainAxisGap.set('8px');
    host.crossAxisGap.set('12px');
    await waitForUpdate();

    expect(addInlineStyle).toHaveBeenCalledWith(
      list(),
      'list-main-axis-gap',
      '8px',
    );
    expect(addInlineStyle).toHaveBeenCalledWith(
      list(),
      'list-cross-axis-gap',
      '12px',
    );
    expect(list().getAttribute('list-main-axis-gap')).toBeNull();
    addInlineStyle.mockRestore();
  });

  it('hands Lynx real booleans, so the defaults that are on can be turned off', async () => {
    // A false used to remove the attribute, which leaves Lynx's default: on.
    const attributes = watchAttributes();
    const { host } = await renderList();
    expect(attributes.last('bounces')).toBe(true);
    expect(attributes.last('scroll-bar-enable')).toBe(true);

    host.bounces.set(false);
    host.scrollBar.set(false);
    host.nestedScroll.set(true);
    host.sticky.set(true);
    await waitForUpdate();
    expect(attributes.last('bounces')).toBe(false);
    expect(attributes.last('scroll-bar-enable')).toBe(false);
    expect(attributes.last('enable-nested-scroll')).toBe(true);
    expect(attributes.last('sticky')).toBe(true);
    attributes.restore();
  });

  it('emits when scrolled to the start or the end', async () => {
    const { host, list } = await renderList();
    fireEvent.scrolltolower(list());
    fireEvent.scrolltoupper(list());
    expect(host.reached).toEqual(['end', 'start']);
  });
});
