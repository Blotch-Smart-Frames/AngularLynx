/**
 * LynxShare in rendered specs.
 *
 * There's no share sheet to tap through in a spec, so a spec provides a
 * stand-in that records what was shared. Without one, share() has to reject,
 * as it does in Lynx Explorer, rather than leave the spec waiting.
 */

import { Component, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxShare,
  type ShareData,
  ShareError,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitForUpdate } from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'export-button',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="export()"><text>Share photo</text></view>
    <text>{{ status() }}</text>
  `,
})
class ExportButton {
  readonly #sharing = inject(LynxShare);
  readonly status = signal('Not shared');

  async export(): Promise<void> {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
      type: 'image/jpeg',
    });
    try {
      const shared = await this.#sharing.share({
        files: [{ blob, name: 'photo.jpg' }],
        title: 'My photo',
      });
      this.status.set(shared ? 'Shared' : 'Closed the sheet');
    } catch (error) {
      this.status.set(
        error instanceof ShareError ? `Error: ${error.code}` : 'Error',
      );
    }
  }
}

describe('LynxShare under the testing library', () => {
  it('shares through a stand-in, which sees what was shared', async () => {
    const shared: ShareData[] = [];
    await render(ExportButton, {
      providers: [
        {
          provide: LynxShare,
          useValue: {
            share: async (data: ShareData) => {
              shared.push(data);
              return true;
            },
          },
        },
      ],
    });

    fireEvent.tap(screen.getByText('Share photo'));
    await settle();

    expect(screen.getByText('Shared')).toBeInTheDocument();
    expect(shared).toEqual([
      {
        files: [{ blob: expect.any(Blob), name: 'photo.jpg' }],
        title: 'My photo',
      },
    ]);
  });

  it('resolves false when the stand-in says the person closed the sheet', async () => {
    await render(ExportButton, {
      providers: [
        { provide: LynxShare, useValue: { share: async () => false } },
      ],
    });

    fireEvent.tap(screen.getByText('Share photo'));
    await settle();

    expect(screen.getByText('Closed the sheet')).toBeInTheDocument();
  });

  // The environment has no NativeModules, as Lynx Explorer has none of the
  // shells' modules.
  it('rejects with unavailable without a stand-in', async () => {
    await render(ExportButton);

    fireEvent.tap(screen.getByText('Share photo'));
    await settle();

    expect(screen.getByText('Error: unavailable')).toBeInTheDocument();
  });
});
