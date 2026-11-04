/**
 * IntersectionObserver in a rendered component, the way issue #226's 3D
 * frame uses it: watching its host, and told when the host comes into view
 * or leaves it by the element's uiappear and uidisappear events.
 */

import {
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, waitForUpdate } from './index.js';

@Component({
  selector: 'test-frame',
  template: `<text>{{ onScreen() ? 'drawing' : 'paused' }}</text>`,
})
class Frame {
  readonly onScreen = signal(true);

  constructor() {
    const watching = new IntersectionObserver((entries) => {
      for (const entry of entries) this.onScreen.set(entry.isIntersecting);
    });
    watching.observe(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement);
    inject(DestroyRef).onDestroy(() => watching.disconnect());
  }
}

@Component({
  selector: 'test-feed',
  imports: [Frame],
  template: `<test-frame />`,
})
class Feed {}

/**
 * Counts a video as seen once half of it is on screen (issue #236).
 */
@Component({
  selector: 'test-video',
  template: `<text>{{ seen() ? 'seen' : 'unseen' }} {{ ratio() }}</text>`,
})
class Video {
  readonly seen = signal(false);
  readonly ratio = signal(0);

  constructor() {
    const watching = new IntersectionObserver(
      ([entry]) => {
        this.ratio.set(entry.intersectionRatio);
        if (entry.intersectionRatio >= 0.5) this.seen.set(true);
      },
      { threshold: 0.5, rootMargin: '0px 0px 100px 0px' },
    );
    watching.observe(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement);
    inject(DestroyRef).onDestroy(() => watching.disconnect());
  }
}

@Component({
  selector: 'test-videos',
  imports: [Video],
  template: `<test-video />`,
})
class Videos {}

describe('IntersectionObserver', () => {
  it('tells a component when its element leaves the view and comes back', async () => {
    const { container, getByText } = await render(Feed);
    const host = container.firstElementChild as Element;
    expect(host.firstElementChild?.tagName).toBe('TEXT');
    getByText('drawing');

    fireEvent.uidisappear(host);
    await waitForUpdate();
    getByText('paused');

    fireEvent.uiappear(host);
    await waitForUpdate();
    getByText('drawing');
  });

  it('brings all of an element into view with uiappear, for an observer with options', async () => {
    const { container, getByText } = await render(Videos);
    const host = container.firstElementChild as Element;
    getByText('unseen 0');

    fireEvent.uiappear(host);
    await waitForUpdate();
    getByText('seen 1');

    fireEvent.uidisappear(host);
    await waitForUpdate();
    getByText('seen 0');
  });
});
