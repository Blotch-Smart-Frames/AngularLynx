/**
 * LynxBackButton under the testing library: the setup gives the environment's
 * background thread an AngularLynxShell module, and pressBackButton() presses
 * back through it as the Android shell does, so a spec can check what the app
 * does with back.
 */

import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxBackButton,
  provideRouter,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { installShellModule } from './back-button.js';
import { pressBackButton, render, screen, waitForUpdate } from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'search-screen',
  imports: [LYNX_ELEMENTS],
  template: `<text>{{ searching() ? 'Searching' : 'Idle' }}</text>`,
})
class Search {
  readonly searching = signal(true);

  constructor() {
    const remove = inject(LynxBackButton).on(() => {
      this.searching.set(false);
      remove();
    });
  }
}

@Component({
  selector: 'home-screen',
  imports: [LYNX_ELEMENTS],
  template: `<text>Home</text>`,
})
class Home {}

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

describe('LynxBackButton under the testing library', () => {
  it("gives a press to the app's handler, then leaves back to Android", async () => {
    await render(Search);
    await settle();
    expect(screen.getByText('Searching')).toBeInTheDocument();

    expect(pressBackButton()).toBe(true);
    await settle();
    expect(screen.getByText('Idle')).toBeInTheDocument();

    // The handler removed itself, so Android has back again.
    expect(pressBackButton()).toBe(false);
  });

  it('goes back a screen through the router', async () => {
    const { componentRef } = await render(Shell, {
      providers: [
        provideRouter([
          { path: '', component: Home },
          { path: 'photos', component: Photos },
        ]),
      ],
    });
    await settle();
    expect(pressBackButton()).toBe(false);

    await componentRef.injector.get(Router).navigateByUrl('/photos');
    await settle();
    expect(screen.getByText('Photos')).toBeInTheDocument();

    expect(pressBackButton()).toBe(true);
    await settle();
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  // Runs after the earlier tests' reset(), which gives the background thread
  // new globals, and with them a new module.
  it('starts each test with back left to Android', () => {
    expect(pressBackButton()).toBe(false);
  });

  it('keeps the modules the thread already has', () => {
    const bridge = {};
    const globals: { NativeModules?: Record<string, unknown> } = {
      NativeModules: { bridge },
    };

    installShellModule(globals);

    expect(globals.NativeModules!['bridge']).toBe(bridge);
    expect(globals.NativeModules!['AngularLynxShell']).toBeDefined();
  });

  it('says what it needs outside the environment', () => {
    const env = (globalThis as any).lynxTestingEnv;
    (globalThis as any).lynxTestingEnv = undefined;
    try {
      expect(() => pressBackButton()).toThrow(
        "needs the testing library's environment",
      );
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });
});
