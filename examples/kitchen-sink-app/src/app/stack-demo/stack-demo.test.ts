import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterOutlet, type Routes } from '@angular/router';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { provideRouter } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StackDemo,
  StackDemoFolder,
  StackDemoFolders,
  StackDemoMessage,
} from './stack-demo';

// The demo's links are relative, so it has to be a route's component, as it
// is in the app, for them to resolve under /stack-demo.
const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'stack-demo' },
  {
    path: 'stack-demo',
    component: StackDemo,
    children: [
      { path: '', component: StackDemoFolders },
      { path: ':folder', component: StackDemoFolder },
      { path: ':folder/:message', component: StackDemoMessage },
    ],
  },
];

@Component({
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class Shell {}

/**
 * Runs change detection, and lets the outlet's timers run, until `done`
 * holds: navigation and a transition take a few ticks.
 */
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 40 && !done(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitForUpdate();
  }
  expect(done()).toBe(true);
};

describe('StackDemo', () => {
  // Component selectors aren't Lynx elements: the renderer warns as it falls
  // back to a <view> for each.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('pushes a folder and a message, and pops back to the mailboxes', async () => {
    const { componentRef, container, queryByText, getByText } = await render(
      Shell,
      {
        providers: [provideRouter(routes)],
      },
    );
    const router = componentRef.injector.get(Router);
    const location = componentRef.injector.get(Location);
    const row = (label: string) =>
      container.querySelector(`[accessibility-label="${label}"]`)!;

    await until(() => queryByText('Mailboxes') !== null);
    // The count's text is in pieces once it changes: read the whole button.
    const counter = getByText('Tapped 0 times').parentElement!;
    fireEvent.tap(counter);
    await until(() => counter.textContent?.trim() === 'Tapped 1 times');

    fireEvent.tap(row('Inbox'));
    await until(() => router.url === '/stack-demo/inbox');
    await until(() => queryByText('Grace') !== null);

    fireEvent.tap(row('Lunch on Friday?'));
    await until(() => router.url === '/stack-demo/inbox/m1');
    await until(() => queryByText('From Ada') !== null);

    // Back pops the message; the folder under it is the same one.
    location.back();
    await until(() => router.url === '/stack-demo/inbox');
    await until(() => queryByText('From Ada') === null);

    // A link to the mailboxes pops back to them, which kept their count.
    fireEvent.tap(row('Lunch on Friday?'));
    await until(() => queryByText('From Ada') !== null);
    fireEvent.tap(getByText('Back to Mailboxes').parentElement!);
    await until(() => router.url === '/stack-demo');
    await until(() => queryByText('Grace') === null);
    expect(counter.textContent?.trim()).toBe('Tapped 1 times');
  });
});
