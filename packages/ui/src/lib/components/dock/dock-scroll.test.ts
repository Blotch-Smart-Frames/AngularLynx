import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { UiDockScroll, UiDockState } from './dock-scroll';

@Component({
  imports: [LYNX_ELEMENTS, UiDockScroll],
  template: `
    @if (shown()) {
      <scroll-view ui-dock-scroll scroll-orientation="vertical">
        <view style="height: 2000px"></view>
      </scroll-view>
    }
  `,
})
class ScrollHost {
  readonly shown = signal(true);
}

const renderScroll = async () => {
  const result = await render(ScrollHost);
  const host = result.componentRef.instance as ScrollHost;
  const state = result.componentRef.injector.get(UiDockState);
  const scrollView = () => result.container.querySelector('scroll-view')!;
  /**
   * Scrolls the content to `scrollTop`, as Lynx reports it.
   */
  const scrollTo = (scrollTop: number) =>
    fireEvent.scroll(scrollView(), {
      detail: { scrollTop, scrollHeight: 2000 },
    });
  return { ...result, host, state, scrollView, scrollTo };
};

describe('UiDockScroll', () => {
  it('minimizes the dock as content scrolls down, and expands it as it scrolls up', async () => {
    const { state, scrollTo } = await renderScroll();
    expect(state.minimized()).toBe(false);

    // A little way down isn't enough: a small drag leaves the dock whole.
    scrollTo(10);
    scrollTo(20);
    expect(state.minimized()).toBe(false);
    scrollTo(30);
    expect(state.minimized()).toBe(true);

    // Further down keeps it minimized.
    scrollTo(300);
    expect(state.minimized()).toBe(true);

    // A glance back up brings it back.
    scrollTo(295);
    scrollTo(290);
    expect(state.minimized()).toBe(true);
    scrollTo(287);
    expect(state.minimized()).toBe(false);
  });

  it('counts the distance again when content turns', async () => {
    const { state, scrollTo } = await renderScroll();
    scrollTo(100);
    expect(state.minimized()).toBe(true);
    scrollTo(80);
    expect(state.minimized()).toBe(false);

    // Down 20 after coming up 20 starts a new count, short of minimizing.
    scrollTo(100);
    expect(state.minimized()).toBe(false);
    // An event with no movement keeps the count.
    scrollTo(100);
    scrollTo(104);
    expect(state.minimized()).toBe(true);
  });

  it('expands the dock at the top, including the bounce above it', async () => {
    const { state, scrollTo } = await renderScroll();
    scrollTo(200);
    expect(state.minimized()).toBe(true);

    scrollTo(5);
    expect(state.minimized()).toBe(false);

    scrollTo(200);
    expect(state.minimized()).toBe(true);
    scrollTo(-30);
    expect(state.minimized()).toBe(false);
  });

  it("ignores iOS's bounce back from past the end", async () => {
    const { state, scrollTo, scrollView } = await renderScroll();
    // The scroll view is 800px tall, so its content ends at 1200.
    fireEvent.layoutchange(scrollView(), {
      detail: { width: 400, height: 800 },
    });
    scrollTo(1150);
    scrollTo(1250);
    expect(state.minimized()).toBe(true);

    // Bouncing back from 1250 to the end reads as scrolling up, but isn't.
    scrollTo(1230);
    scrollTo(1210);
    expect(state.minimized()).toBe(true);

    // Scrolling up from the end is.
    scrollTo(1200);
    scrollTo(1180);
    expect(state.minimized()).toBe(false);
  });

  it('expands the dock when the scroll view goes, and stops listening', async () => {
    const { host, state, scrollTo, scrollView } = await renderScroll();
    const removed = scrollView();
    scrollTo(200);
    expect(state.minimized()).toBe(true);

    host.shown.set(false);
    await waitForUpdate();
    expect(state.minimized()).toBe(false);

    fireEvent.scroll(removed, {
      detail: { scrollTop: 600, scrollHeight: 2000 },
    });
    expect(state.minimized()).toBe(false);
  });
});
