/**
 * LynxImagePicker in rendered specs (issue #305).
 *
 * There's no photo picker to tap through in a spec, so a spec provides a
 * stand-in that resolves with the image it needs. Without one, pick() has to
 * reject, as it does in Lynx Explorer, rather than leave the spec waiting.
 */

import { Component, inject, signal } from '@angular/core';
import {
  ImagePickerError,
  LYNX_ELEMENTS,
  LynxImagePicker,
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
  selector: 'profile-picture',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="change()"><text>Change picture</text></view>
    <text>{{ status() }}</text>
  `,
})
class ProfilePicture {
  readonly #picker = inject(LynxImagePicker);
  readonly status = signal('No picture');

  async change(): Promise<void> {
    try {
      const picked = await this.#picker.pick({ maxDimension: 1024 });
      if (!picked) {
        this.status.set('Kept the old picture');
        return;
      }
      const bytes = new Uint8Array(await picked.blob.arrayBuffer());
      this.status.set(`${picked.name}, ${picked.type}, ${bytes.length} bytes`);
    } catch (error) {
      this.status.set(
        error instanceof ImagePickerError ? `Error: ${error.code}` : 'Error',
      );
    }
  }
}

describe('LynxImagePicker under the testing library', () => {
  it('resolves with what a stand-in hands it', async () => {
    const picked = {
      blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
        type: 'image/jpeg',
      }),
      name: 'me.jpg',
      type: 'image/jpeg',
    };
    await render(ProfilePicture, {
      providers: [
        { provide: LynxImagePicker, useValue: { pick: async () => picked } },
      ],
    });

    fireEvent.tap(screen.getByText('Change picture'));
    await settle();

    expect(screen.getByText('me.jpg, image/jpeg, 3 bytes')).toBeInTheDocument();
  });

  it('resolves with null when the stand-in says the person closed it', async () => {
    await render(ProfilePicture, {
      providers: [
        { provide: LynxImagePicker, useValue: { pick: async () => null } },
      ],
    });

    fireEvent.tap(screen.getByText('Change picture'));
    await settle();

    expect(screen.getByText('Kept the old picture')).toBeInTheDocument();
  });

  // The environment has no NativeModules, as Lynx Explorer has none of the
  // shells' modules.
  it('rejects with unavailable without a stand-in', async () => {
    await render(ProfilePicture);

    fireEvent.tap(screen.getByText('Change picture'));
    await settle();

    expect(screen.getByText('Error: unavailable')).toBeInTheDocument();
  });
});
