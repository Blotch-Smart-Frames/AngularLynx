/**
 * LynxShareTarget under the testing library: the setup gives the
 * environment's background thread an AngularLynxShareTarget module, and
 * receiveShare() shares to the app through it as the shells do, so a spec can
 * check what the app does with what another app's share sheet sends it.
 */

import { Component, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxShareTarget,
  type ReceivedShare,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { receiveShare, render, screen, waitForUpdate } from './index.js';
import { installShareTargetModule } from './share-target.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'share-inbox',
  imports: [LYNX_ELEMENTS],
  template: `
    <text>{{ shares().length }} shares</text>
    @for (share of shares(); track $index) {
      <text>{{ share.title }}: {{ share.text }} {{ share.url }}</text>
      @for (file of share.files; track file.name) {
        <text>{{ file.name }} {{ file.type }} {{ file.size }}</text>
      }
    }
  `,
})
class Inbox {
  readonly shares = signal<readonly ReceivedShare[]>([]);

  constructor() {
    inject(LynxShareTarget).onShare((share) =>
      this.shares.update((shares) => [...shares, share]),
    );
  }
}

describe('LynxShareTarget under the testing library', () => {
  it('hands the app what was shared to it', async () => {
    await render(Inbox);
    await settle();
    expect(screen.getByText('0 shares')).toBeInTheDocument();

    await receiveShare({
      title: 'A page',
      text: 'Read later',
      url: 'https://example.com/a',
      files: [
        { blob: new Blob(['hello'], { type: 'text/plain' }), name: 'a.txt' },
        { blob: new Blob([new Uint8Array([1, 2, 3])]), name: 'raw' },
      ],
    });
    await settle();

    expect(screen.getByText('1 shares')).toBeInTheDocument();
    expect(
      screen.getByText('A page: Read later https://example.com/a'),
    ).toBeInTheDocument();
    expect(screen.getByText('a.txt text/plain 5')).toBeInTheDocument();
    expect(
      screen.getByText('raw application/octet-stream 3'),
    ).toBeInTheDocument();
  });

  it('keeps a share sent before the app started for it, as the one that starts an app', async () => {
    await receiveShare({ text: 'Early' });

    await render(Inbox);
    await settle();

    expect(screen.getByText('1 shares')).toBeInTheDocument();
  });

  // Runs after the earlier tests' reset(), which gives the background thread
  // new globals, and with them a new module.
  it('starts each test with no share waiting', async () => {
    await render(Inbox);
    await settle();

    expect(screen.getByText('0 shares')).toBeInTheDocument();
  });

  it('keeps the modules the thread already has', () => {
    const bridge = {};
    const globals: { NativeModules?: Record<string, unknown> } = {
      NativeModules: { bridge },
    };

    installShareTargetModule(globals);

    expect(globals.NativeModules!['bridge']).toBe(bridge);
    expect(globals.NativeModules!['AngularLynxShareTarget']).toBeDefined();
  });

  it('says what it needs outside the environment', async () => {
    const env = (globalThis as any).lynxTestingEnv;
    (globalThis as any).lynxTestingEnv = undefined;
    try {
      await expect(receiveShare({ text: 'x' })).rejects.toThrow(
        "needs the testing library's environment",
      );
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });
});
