/**
 * LynxAppState under the testing library: setAppState() changes the host's
 * global props as the shells do when the app leaves the screen and comes
 * back, so a spec can check what the app does on its return.
 */

import { Component, effect, inject, signal, untracked } from '@angular/core';
import { LYNX_ELEMENTS, LynxAppState } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { render, screen, setAppState, waitForUpdate } from './index.js';

@Component({
  selector: 'app-clock',
  imports: [LYNX_ELEMENTS],
  template: `
    <text>State: {{ appState.state() }}</text>
    <text>Returns: {{ returns() }}</text>
  `,
})
class Clock {
  readonly appState = inject(LynxAppState);
  readonly returns = signal(0);

  constructor() {
    // What an app does on its return: catch up, as the issue's clock does.
    let wasAway = false;
    effect(() => {
      const active = this.appState.active();
      if (active && wasAway) untracked(() => this.returns.update((n) => n + 1));
      wasAway = !active;
    });
  }
}

describe('setAppState()', () => {
  it('starts each test active', async () => {
    await render(Clock);

    expect(screen.getByText('State: active')).toBeTruthy();
  });

  it('sends the app to the background and brings it back', async () => {
    await render(Clock);

    setAppState('inactive');
    await waitForUpdate();
    expect(screen.getByText('State: inactive')).toBeTruthy();

    setAppState('background');
    await waitForUpdate();
    expect(screen.getByText('State: background')).toBeTruthy();

    setAppState('active');
    await waitForUpdate();
    expect(screen.getByText('State: active')).toBeTruthy();
    expect(screen.getByText('Returns: 1')).toBeTruthy();
  });

  it('keeps the global props the host sent before', async () => {
    await render(Clock, { initialURL: 'myapp://orders/42' });

    setAppState('background');

    const env = (globalThis as any).lynxTestingEnv;
    for (const thread of [env.mainThread, env.backgroundThread]) {
      expect(thread.globalThis.lynx.__globalProps).toMatchObject({
        initialURL: 'myapp://orders/42',
        appState: 'background',
      });
    }
  });

  it("throws outside the testing library's environment", () => {
    const env = (globalThis as any).lynxTestingEnv;
    (globalThis as any).lynxTestingEnv = undefined;
    try {
      expect(() => setAppState('background')).toThrow(/environment/);
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });
});
