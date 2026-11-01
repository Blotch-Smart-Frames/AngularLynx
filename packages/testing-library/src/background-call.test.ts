/**
 * Background calls in rendered specs (issue #198).
 *
 * Angular runs on the main thread, and the services that need the background
 * thread, such as LynxLocalStorage and LynxSecureStorage, relay their calls
 * there. The testing environment emulates both threads but loads the runtime
 * once, on the main thread, so nothing answered on the background thread: the
 * calls never settled, and a spec reading storage timed out instead of
 * getting the in-memory store, as Lynx Explorer does. The runtime now
 * installs both halves of its relay there (background-call.ts).
 */

import { Component, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibility,
  LynxLocalStorage,
  LynxNativeModule,
  LynxSecureStorage,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { render, screen, waitForUpdate } from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'session-label',
  imports: [LYNX_ELEMENTS],
  template: `<text>{{ label() }}</text>`,
})
class SessionLabel {
  readonly #storage = inject(LynxSecureStorage);
  readonly label = signal('Loading');

  constructor() {
    void this.#load();
  }

  async #load() {
    await this.#storage.setItem('session', { user: 'ada' });
    const session = await this.#storage.getItem<{ user: string }>('session');
    this.label.set(`Signed in as ${session?.user}`);
  }
}

@Component({
  selector: 'units-label',
  imports: [LYNX_ELEMENTS],
  template: `<text>{{ label() }}</text>`,
})
class UnitsLabel {
  readonly #storage = inject(LynxLocalStorage);
  readonly label = signal('Loading');

  constructor() {
    void this.#load();
  }

  async #load() {
    const before = await this.#storage.getItem('units');
    await this.#storage.setItem('units', 'metric');
    this.label.set(`${before} then ${await this.#storage.getItem('units')}`);
  }
}

describe('background calls under the testing library', () => {
  it('keeps LynxSecureStorage values in memory, as Lynx Explorer does', async () => {
    await render(SessionLabel);
    await settle();

    expect(screen.getByText('Signed in as ada')).toBeInTheDocument();
  });

  // Runs after the first test's reset(), which gives each thread new
  // contexts: the relay has to be installed on those too.
  it('still answers after the environment resets', async () => {
    await render(UnitsLabel);
    await settle();

    expect(screen.getByText('null then metric')).toBeInTheDocument();
  });

  // The environment has no NativeModules, like Lynx Explorer has none of the
  // app's own modules.
  it('answers native module calls as a host without the module does', async () => {
    const modules = new LynxNativeModule();
    const missing = modules.getNativeModule('Missing') as {
      ping(): Promise<unknown>;
    };

    await expect(missing.ping()).rejects.toThrow(
      'NativeModules: Missing.ping is not available',
    );
    await expect(modules.call('getDeviceId')).resolves.toBeUndefined();
  });

  it("rejects a call to a Lynx API the environment's background thread lacks", async () => {
    await expect(new LynxAccessibility().announce('Saved')).rejects.toThrow(
      'lynx.accessibilityAnnounce is not available in this environment',
    );
  });
});
