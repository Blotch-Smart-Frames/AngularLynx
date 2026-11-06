/**
 * LynxLinking under the testing library (issue #304): the setup gives the
 * environment's background thread an AngularLynxLinking module that records
 * each URL, so a spec can check where a tap leads.
 */

import { Component, inject, signal } from '@angular/core';
import { LYNX_ELEMENTS, LynxLinking } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import {
  fireEvent,
  openedURLs,
  render,
  screen,
  waitForUpdate,
} from './index.js';
import { installLinkingModule } from './linking.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'help-links',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="openDocs()"><text>Docs</text></view>
    <view (bindtap)="mail()"><text>Email us</text></view>
    <text>{{ status() }}</text>
  `,
})
class HelpLinks {
  readonly #linking = inject(LynxLinking);
  readonly status = signal('');

  constructor() {
    void this.#linking
      .canOpenURL('mailto:support@example.com')
      .then((can) => this.status.set(can ? 'Mail ready' : 'No mail'));
  }

  openDocs(): void {
    void this.#linking
      .openInApp('https://example.com/docs')
      .then(() => this.status.set('Back from the docs'));
  }

  mail(): void {
    void this.#linking.openURL('mailto:support@example.com');
  }
}

describe('LynxLinking under the testing library', () => {
  it('records the URLs a tap opens, and says they can open', async () => {
    await render(HelpLinks);
    await settle();
    expect(screen.getByText('Mail ready')).toBeInTheDocument();

    fireEvent.tap(screen.getByText('Docs'));
    fireEvent.tap(screen.getByText('Email us'));
    await settle();

    expect(openedURLs()).toEqual([
      { url: 'https://example.com/docs', inApp: true },
      { url: 'mailto:support@example.com', inApp: false },
    ]);
    expect(screen.getByText('Back from the docs')).toBeInTheDocument();
  });

  // Runs after the first test's reset(), which gives the background thread
  // new globals, and with them a new module.
  it('starts each test with no URLs recorded', () => {
    expect(openedURLs()).toEqual([]);
  });

  it('gives a copy, so a spec cannot change the record', async () => {
    await render(HelpLinks);
    fireEvent.tap(screen.getByText('Docs'));
    // One task is enough for the call to reach the module, as the docs say.
    await waitForUpdate();

    (openedURLs() as unknown[]).length = 0;
    expect(openedURLs()).toHaveLength(1);
  });

  it('keeps the modules the thread already has', () => {
    const bridge = {};
    const globals: { NativeModules?: Record<string, unknown> } = {
      NativeModules: { bridge },
    };

    installLinkingModule(globals);

    expect(globals.NativeModules!['bridge']).toBe(bridge);
    expect(globals.NativeModules!['AngularLynxLinking']).toBeDefined();
  });

  it('records nothing outside the environment', () => {
    const env = (globalThis as any).lynxTestingEnv;
    (globalThis as any).lynxTestingEnv = undefined;
    try {
      expect(openedURLs()).toEqual([]);
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });
});
