import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { lynxMainThread } from '../../../test-utils/lynx-main-thread';
import { UiScrollArea } from './scroll-area';

@Component({
  imports: [UiScrollArea, LYNX_ELEMENTS],
  template: `
    <ui-scroll-area
      [orientation]="orientation()"
      [height]="height()"
      [bounces]="bounces()"
      [scrollBar]="scrollBar()"
      [nestedScroll]="nestedScroll()"
      class="bg-card"
      contentClass="gap-2"
      (scrolledToStart)="reached.push('start')"
      (scrolledToEnd)="reached.push('end')"
    >
      <text>Body</text>
    </ui-scroll-area>
  `,
})
class ScrollAreaHost {
  readonly orientation = signal<'vertical' | 'horizontal'>('vertical');
  readonly height = signal('');
  readonly bounces = signal(true);
  readonly scrollBar = signal(true);
  readonly nestedScroll = signal(false);
  readonly reached: string[] = [];
}

const renderScrollArea = async () => {
  const result = await render(ScrollAreaHost);
  return {
    ...result,
    host: result.componentRef.instance as ScrollAreaHost,
    scrollView: () => result.container.querySelector('scroll-view')!,
    /** The scroll area's box, its host, which the scroll view fills. */
    box: () => result.container.querySelector('scroll-view')!.parentElement!,
    /** The view inside the scroll view that lays out the content. */
    content: () => result.getByText('Body').parentElement!,
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

describe('UiScrollArea', () => {
  it('renders projected content in a vertical scroll view', async () => {
    const { scrollView, box, content } = await renderScrollArea();
    expect(scrollView().getAttribute('scroll-orientation')).toBe('vertical');
    expect(scrollView().classList).toContain('grow');
    expect(box().classList).toContain('w-full');
    expect(box().classList).toContain('bg-card');
    expect(content().classList).toContain('flex-col');
    expect(content().classList).toContain('gap-2');
  });

  // Angular gives a component's host every static attribute written on it,
  // so the scroll view taking the class as well applied it twice (issue
  // #181).
  it('puts its class on one element, its box', async () => {
    const { container, box } = await renderScrollArea();
    expect([...container.querySelectorAll('.bg-card')]).toEqual([box()]);
  });

  it('gives the scroll view an explicit height, which it needs to scroll', async () => {
    const { host, scrollView } = await renderScrollArea();
    expect(scrollView().getAttribute('style') ?? '').not.toContain('height');

    host.height.set('250px');
    await waitForUpdate();
    expect(scrollView().getAttribute('style')).toContain('height: 250px');
  });

  it('lays the content out in a row when horizontal', async () => {
    const { host, scrollView, content } = await renderScrollArea();
    host.orientation.set('horizontal');
    await waitForUpdate();
    expect(scrollView().getAttribute('scroll-orientation')).toBe('horizontal');
    expect(content().classList).toContain('flex-row');
  });

  it('hands Lynx real booleans, so the defaults that are on can be turned off', async () => {
    // A false used to remove the attribute, which leaves Lynx's default: on.
    const attributes = watchAttributes();
    const { host } = await renderScrollArea();
    expect(attributes.last('bounces')).toBe(true);
    expect(attributes.last('scroll-bar-enable')).toBe(true);

    host.bounces.set(false);
    host.scrollBar.set(false);
    host.nestedScroll.set(true);
    await waitForUpdate();
    expect(attributes.last('bounces')).toBe(false);
    expect(attributes.last('scroll-bar-enable')).toBe(false);
    expect(attributes.last('enable-nested-scroll')).toBe(true);
    attributes.restore();
  });

  it('emits when scrolled to the start or the end', async () => {
    const { host, scrollView } = await renderScrollArea();
    fireEvent.scrolltolower(scrollView());
    fireEvent.scrolltoupper(scrollView());
    expect(host.reached).toEqual(['end', 'start']);
  });
});
