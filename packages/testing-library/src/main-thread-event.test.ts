/**
 * A main-thread script beside the element's other listeners for the same
 * event (issue #471). Lynx keeps one native handler per event name on an
 * element, and the directive used to take it for its script, so a `(bindtap)`
 * next to a `[mainThreadBindtap]` never ran, and an IntersectionObserver
 * inside a `[mainThreadBindscroll]` scroll-view never heard it scroll.
 */

import {
  Component,
  Directive,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxMainThreadEvent,
  mainThreadFn,
  type MainThread,
} from '@blotch/angular-lynx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitForUpdate } from './index.js';

/** What the scripts below were called with, by their name. */
const scriptCalls: { name: string; event: MainThread.TouchEvent }[] = [];

const countScript = mainThreadFn((event: MainThread.TouchEvent) => {
  scriptCalls.push({ name: 'script', event });
});

const otherScript = mainThreadFn((event: MainThread.TouchEvent) => {
  scriptCalls.push({ name: 'other', event });
});

@Component({
  selector: 'test-both',
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent],
  template: `
    <view
      class="target"
      [mainThreadBindtap]="script()"
      (bindtap)="taps.update((n) => n + 1)"
    >
      <text>Taps: {{ taps() }}</text>
    </view>
  `,
})
class Both {
  readonly taps = signal(0);
  readonly script = signal<typeof countScript | null>(countScript);
}

/**
 * The elements Angular made, in the order it made them, as an app's
 * directive would inject one. A `viewChild()` query would need the metadata
 * ahead-of-time compilation adds, and these specs compile just in time.
 */
const madeElements: unknown[] = [];

@Directive({ selector: '[testElement]' })
class TestElement {
  constructor() {
    madeElements.push(inject(ElementRef).nativeElement);
  }
}

@Component({
  selector: 'test-feed',
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent, TestElement],
  template: `
    <scroll-view
      testElement
      class="scroller"
      scroll-orientation="vertical"
      [mainThreadBindscroll]="onScroll"
      (bindscroll)="scrolls.update((n) => n + 1)"
    >
      <view testElement class="card"><text>Card</text></view>
    </scroll-view>
  `,
})
class Feed {
  readonly onScroll = countScript;
  readonly scrolls = signal(0);
}

@Component({
  selector: 'test-caught',
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent],
  template: `
    <view (bindtap)="outer.update((n) => n + 1)">
      <view class="target" [mainThreadCatchtap]="onTap">
        <text>Inner</text>
      </view>
    </view>
  `,
})
class Caught {
  readonly onTap = countScript;
  readonly outer = signal(0);
}

afterEach(() => {
  scriptCalls.length = 0;
  madeElements.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LynxMainThreadEvent beside other listeners', () => {
  it('runs a template listener for the same event as well as the script', async () => {
    const { container, getByText } = await render(Both);
    const target = container.querySelector('.target')!;

    fireEvent.tap(target);
    await waitForUpdate();

    getByText('Taps: 1');
    expect(scriptCalls.map((call) => call.name)).toEqual(['script']);
  });

  it("replaces the script when its input changes, and runs none once it's null", async () => {
    const { container, componentRef, getByText } = await render(Both);
    const target = container.querySelector('.target')!;

    componentRef.instance.script.set(otherScript);
    await waitForUpdate();
    fireEvent.tap(target);
    await waitForUpdate();
    expect(scriptCalls.map((call) => call.name)).toEqual(['other']);

    componentRef.instance.script.set(null);
    await waitForUpdate();
    fireEvent.tap(target);
    await waitForUpdate();
    expect(scriptCalls).toHaveLength(1);
    // The template's listener still runs on its own.
    getByText('Taps: 2');
  });

  it('lets an IntersectionObserver inside the scroll container hear it scroll', async () => {
    const { container, componentRef } = await render(Feed);
    const scroller = container.querySelector('.scroller')!;
    const [scrollView, card] = madeElements as Element[];
    // With a root, the observer measures the card itself, and again while
    // the scroll-view scrolls (see the runtime's intersection-observer.ts).
    const observer = new IntersectionObserver(() => {}, { root: scrollView });
    observer.observe(card!);
    // Its first measurement, with no layout here, which finds the scroll-view
    // it then listens to.
    fireEvent.uiappear(container.querySelector('.card')!);
    await waitForUpdate();
    const uiMethods = vi.spyOn(globalThis as any, '__InvokeUIMethod');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    // Read straight away: change detection waits for the fake clock.
    fireEvent.scroll(scroller);
    expect(componentRef.instance.scrolls()).toBe(1);
    expect(scriptCalls.map((call) => call.name)).toEqual(['script']);
    // The observer measures again on the next sample.
    vi.advanceTimersByTime(50);
    expect(
      uiMethods.mock.calls.filter(
        ([, method]) => method === 'boundingClientRect',
      ),
    ).not.toHaveLength(0);

    observer.disconnect();
  });

  it('stops the event at the element for a catch script, after every listener ran', async () => {
    const { container, componentRef } = await render(Caught);

    fireEvent.tap(container.querySelector('.target')!);
    await waitForUpdate();

    expect(scriptCalls.map((call) => call.name)).toEqual(['script']);
    expect(componentRef.instance.outer()).toBe(0);
  });
});
