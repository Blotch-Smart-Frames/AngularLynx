/**
 * Links to the app under the testing library (issue #445): openLink() sends
 * a link through the setup's AngularLynxLinking module as the shells do, so a
 * spec can check where a link leads.
 */

import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxLinking,
  provideRouter,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { openLink, render, screen, waitForUpdate } from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'link-log',
  imports: [LYNX_ELEMENTS],
  template: `<text>Last link: {{ last() }}</text>`,
})
class LinkLog {
  readonly last = signal('none');

  constructor() {
    inject(LynxLinking).onURL((url) => this.last.set(url));
  }
}

@Component({
  selector: 'order-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Order {{ id }}</text>`,
})
class Order {
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
}

@Component({
  selector: 'app-shell',
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `<view><router-outlet /></view>`,
})
class Shell {}

describe('openLink', () => {
  it('hands the link to the onURL handlers', async () => {
    await render(LinkLog);
    await settle();

    openLink('myapp://orders/42');
    await settle();

    expect(
      screen.getByText('Last link: myapp://orders/42'),
    ).toBeInTheDocument();
  });

  it('keeps a link sent before the app listens for the first handler', async () => {
    openLink('myapp://early');

    await render(LinkLog);
    await settle();

    expect(screen.getByText('Last link: myapp://early')).toBeInTheDocument();
  });

  it("navigates the router to the link's route", async () => {
    await render(Shell, {
      providers: [
        provideRouter([
          { path: '', component: LinkLog },
          { path: 'orders/:id', component: Order },
        ]),
      ],
    });
    await settle();
    expect(screen.getByText('Last link: none')).toBeInTheDocument();

    openLink('myapp://orders/7');
    await settle();

    expect(screen.getByText('Order 7')).toBeInTheDocument();
  });

  // Runs after the earlier tests' reset(), which gives the background thread
  // new globals, and with them a new module.
  it('starts each test with no link waiting', async () => {
    await render(LinkLog);
    await settle();

    expect(screen.getByText('Last link: none')).toBeInTheDocument();
  });

  it('says what it needs outside the environment', () => {
    const env = (globalThis as any).lynxTestingEnv;
    (globalThis as any).lynxTestingEnv = undefined;
    try {
      expect(() => openLink('myapp://x')).toThrow(
        "needs the testing library's environment",
      );
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });
});
