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
});
