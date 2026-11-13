/**
 * LynxShortcuts under the testing library: the setup gives the environment's
 * background thread an AngularLynxShortcuts module, and runShortcut() runs a
 * shortcut through it as the shells do, so a spec can check what the app does
 * when the person asks Siri for it.
 */

import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxShortcuts,
  provideRouter,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { render, runShortcut, screen, waitForUpdate } from './index.js';
import { installShortcutsModule } from './shortcuts.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'news-feed',
  imports: [LYNX_ELEMENTS],
  template: `<text>Refreshed {{ refreshes() }} times</text>`,
})
class Feed {
  readonly refreshes = signal(0);

  constructor() {
    inject(LynxShortcuts).on('refresh', () =>
      this.refreshes.update((count) => count + 1),
    );
  }
}

@Component({
  selector: 'photo-list',
  imports: [LYNX_ELEMENTS],
  template: `<text>Photos</text>`,
})
class Photos {}

@Component({
  selector: 'app-shell',
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `<view><router-outlet /></view>`,
})
class Shell {}

describe('LynxShortcuts under the testing library', () => {
  it('runs a shortcut the app handles', async () => {
    await render(Feed);
    await settle();
    expect(screen.getByText('Refreshed 0 times')).toBeInTheDocument();

    runShortcut('refresh');
    await settle();
    expect(screen.getByText('Refreshed 1 times')).toBeInTheDocument();

    runShortcut('refresh');
    await settle();
    expect(screen.getByText('Refreshed 2 times')).toBeInTheDocument();
  });

  it('keeps a shortcut run before the app started for it, as the one that starts an app', async () => {
    runShortcut('refresh');

    await render(Feed);
    await settle();

    expect(screen.getByText('Refreshed 1 times')).toBeInTheDocument();
  });

  it("navigates to a shortcut's route", async () => {
    await render(Shell, {
      providers: [
        provideRouter([
          { path: '', component: Feed },
          { path: 'photos', component: Photos },
        ]),
      ],
    });
    await settle();
    expect(screen.getByText('Refreshed 0 times')).toBeInTheDocument();

    runShortcut('photos', { route: '/photos' });
    await settle();

    expect(screen.getByText('Photos')).toBeInTheDocument();
  });

  // Runs after the earlier tests' reset(), which gives the background thread
  // new globals, and with them a new module.
  it('starts each test with no shortcut waiting', async () => {
    await render(Feed);
    await settle();

    expect(screen.getByText('Refreshed 0 times')).toBeInTheDocument();
  });

  it('keeps the modules the thread already has', () => {
    const bridge = {};
    const globals: { NativeModules?: Record<string, unknown> } = {
      NativeModules: { bridge },
    };

    installShortcutsModule(globals);

    expect(globals.NativeModules!['bridge']).toBe(bridge);
    expect(globals.NativeModules!['AngularLynxShortcuts']).toBeDefined();
  });

  it('says what it needs outside the environment', () => {
    const env = (globalThis as any).lynxTestingEnv;
    (globalThis as any).lynxTestingEnv = undefined;
    try {
      expect(() => runShortcut('refresh')).toThrow(
        "needs the testing library's environment",
      );
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });
});
