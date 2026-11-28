/**
 * LynxPhotoLibrary in rendered specs (issue #927).
 *
 * The setup file gives the environment a photo library module whose saves
 * savedPhotos() lists and whose permission setPhotoLibraryPermission()
 * sets. Saves go through the background thread, as the shells' do.
 */

import { Component, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxPhotoLibrary,
  PhotoLibraryError,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import {
  fireEvent,
  render,
  savedPhotos,
  screen,
  setPhotoLibraryPermission,
  waitForUpdate,
} from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'photo-editor',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="save()"><text>Save to Photos</text></view>
    <text>{{ status() }}</text>
    <text>Permission: {{ photos.addPermission() }}</text>
  `,
})
class PhotoEditor {
  readonly photos = inject(LynxPhotoLibrary);
  readonly status = signal('Not saved');

  async save(): Promise<void> {
    try {
      const id = await this.photos.save({
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
        name: 'edit.jpg',
      });
      this.status.set(`Saved ${id}`);
    } catch (error) {
      this.status.set(
        error instanceof PhotoLibraryError ? `Error: ${error.code}` : 'Error',
      );
    }
  }
}

describe('LynxPhotoLibrary under the testing library', () => {
  it('starts undetermined, and the first save asks and is allowed', async () => {
    await render(PhotoEditor);
    await settle();
    expect(screen.getByText('Permission: undetermined')).toBeInTheDocument();

    fireEvent.tap(screen.getByText('Save to Photos'));
    await settle();

    expect(screen.getByText('Saved fake-photo-1')).toBeInTheDocument();
    expect(screen.getByText('Permission: granted')).toBeInTheDocument();
    expect(savedPhotos()).toEqual([
      {
        id: 'fake-photo-1',
        name: 'edit.jpg',
        type: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3]),
      },
    ]);
  });

  it('starts each test with an empty library', () => {
    expect(savedPhotos()).toEqual([]);
  });

  it('rejects with permission-denied once the person has said no', async () => {
    setPhotoLibraryPermission('denied');
    await render(PhotoEditor);
    await settle();
    expect(screen.getByText('Permission: denied')).toBeInTheDocument();

    fireEvent.tap(screen.getByText('Save to Photos'));
    await settle();

    expect(screen.getByText('Error: permission-denied')).toBeInTheDocument();
    expect(savedPhotos()).toEqual([]);
  });

  it('rejects with unavailable on a phone without the module', async () => {
    setPhotoLibraryPermission('unsupported');
    await render(PhotoEditor);

    fireEvent.tap(screen.getByText('Save to Photos'));
    await settle();

    expect(screen.getByText('Error: unavailable')).toBeInTheDocument();
    expect(screen.getByText('Permission: unsupported')).toBeInTheDocument();
  });

  it('saves with limited access', async () => {
    setPhotoLibraryPermission('limited');
    await render(PhotoEditor);

    fireEvent.tap(screen.getByText('Save to Photos'));
    await settle();

    expect(screen.getByText('Saved fake-photo-1')).toBeInTheDocument();
    expect(screen.getByText('Permission: limited')).toBeInTheDocument();
  });

  it('needs the environment', () => {
    const env = (globalThis as any).lynxTestingEnv;
    const modules = env.backgroundThread.globalThis.NativeModules;
    const module = modules.AngularLynxPhotoLibrary;
    delete modules.AngularLynxPhotoLibrary;
    try {
      expect(() => savedPhotos()).toThrow(/needs the testing library/);
    } finally {
      modules.AngularLynxPhotoLibrary = module;
    }
  });
});
