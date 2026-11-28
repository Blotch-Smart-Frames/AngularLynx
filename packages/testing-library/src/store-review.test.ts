/**
 * LynxStoreReview under the testing library: the setup gives the
 * environment's background thread an AngularLynxStoreReview module, which
 * counts each request, so a spec can check when the app asks for a rating.
 */

import { Component, inject, signal } from '@angular/core';
import { LYNX_ELEMENTS, LynxStoreReview } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import {
  fireEvent,
  render,
  reviewRequests,
  screen,
  waitForUpdate,
} from './index.js';
import { installStoreReviewModule } from './store-review.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'order-checkout',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="place()"><text>Place order</text></view>
    <text>{{ status() }}</text>
  `,
})
class Checkout {
  readonly #storeReview = inject(LynxStoreReview);
  readonly status = signal('open');

  async place() {
    this.status.set('placed');
    await this.#storeReview.request();
    this.status.set('asked');
  }
}

describe('reviewRequests', () => {
  it('counts the requests the app makes, and request() resolves', async () => {
    await render(Checkout);
    expect(reviewRequests()).toBe(0);

    fireEvent.tap(screen.getByText('Place order').parentElement!);
    await settle();
    expect(reviewRequests()).toBe(1);
    expect(screen.getByText('asked')).toBeInTheDocument();

    fireEvent.tap(screen.getByText('Place order').parentElement!);
    await settle();
    expect(reviewRequests()).toBe(2);
  });

  // The reset after the previous test installed a new module.
  it('starts each test at 0', () => {
    expect(reviewRequests()).toBe(0);
  });

  it('is 0 outside the environment', () => {
    const env = (globalThis as any).lynxTestingEnv;
    try {
      (globalThis as any).lynxTestingEnv = undefined;
      expect(reviewRequests()).toBe(0);
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });

  it('keeps the modules the thread already has', () => {
    const other = {};
    const globals: { NativeModules?: Record<string, unknown> } = {
      NativeModules: { Other: other },
    };
    installStoreReviewModule(globals);
    expect(globals.NativeModules?.['Other']).toBe(other);
    expect(globals.NativeModules?.['AngularLynxStoreReview']).toBeDefined();

    const empty: { NativeModules?: Record<string, unknown> } = {};
    installStoreReviewModule(empty);
    expect(Object.keys(empty.NativeModules ?? {})).toEqual([
      'AngularLynxStoreReview',
    ]);
  });
});
