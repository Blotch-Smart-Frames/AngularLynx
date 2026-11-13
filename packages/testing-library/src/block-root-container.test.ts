/**
 * A directive that injects ViewContainerRef, as `<router-outlet>` does, on
 * the root element of an `@if` block. Angular builds the block's view before
 * it inserts it, and asks the renderer to put the container's anchor in a
 * parent the element doesn't have yet: Angular's DOM renderer skips that,
 * and the Lynx renderer threw.
 */

import {
  Component,
  Directive,
  ViewContainerRef,
  inject,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { render, waitForUpdate } from './index.js';

@Directive({ selector: '[container]' })
class Container {
  readonly container = inject(ViewContainerRef);
}

@Component({
  imports: [LYNX_ELEMENTS, Container],
  template: `
    @if (shown()) {
      <view container class="block-root"><text>inside</text></view>
    }
  `,
})
class BlockRoot {
  readonly shown = signal(true);
}

describe('a container on the root element of a block', () => {
  it('renders, and goes and comes back with the block', async () => {
    const { container, componentRef } = await render(BlockRoot);
    expect(container.querySelector('.block-root')?.textContent).toBe('inside');

    componentRef.instance.shown.set(false);
    await waitForUpdate();
    expect(container.querySelector('.block-root')).toBeNull();

    componentRef.instance.shown.set(true);
    await waitForUpdate();
    expect(container.querySelector('.block-root')?.textContent).toBe('inside');
  });
});
