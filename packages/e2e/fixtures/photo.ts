import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ImagePickerError,
  LYNX_ELEMENTS,
  LynxImagePicker,
} from '@blotch/angular-lynx';

/**
 * The static server's echo (HTTP_DATA in src/static-server.ts), which
 * answers with the Content-Type the request arrived with and how many bytes
 * its body had. A fixed URL, as in counter.ts: Lynx has no page URL.
 */
const ECHO_URL = 'http://127.0.0.1:3210/e2e-echo';

/**
 * Sends `blob` with XMLHttpRequest, as Firebase Storage's uploadBytes does.
 */
const upload = (blob: Blob): Promise<{ reply: string; bytes: number }> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', ECHO_URL);
    xhr.responseType = 'json';
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(blob);
  });

/**
 * E2E fixture for LynxImagePicker (issue #305), loaded through
 * `loadComponent` like storage.ts; canvas.ts links here. "Pick photo" opens
 * the platform's picker (the browser's file dialog on the web), asks for the
 * photo scaled to 64 pixels, then uploads the Blob it got to the echo and
 * shows "Photo: uploaded as image/jpeg" when every byte arrived with the
 * Blob's type as its Content-Type. That's the whole path a profile picture
 * takes: the shell's module, the bytes' way to the main thread, the Blob, and
 * the main thread's XMLHttpRequest and fetch relay.
 *
 * Closing the picker shows "Photo: canceled". Lynx Explorer has no picker,
 * and shows "Photo: unavailable".
 *
 * "Open web view", beside "Pick photo", opens webview.ts. On CI's 320x640
 * Android emulator, the canvas page's row of links is the last thing on the
 * screen, so there's no room for another there.
 */
@Component({
  selector: 'app-photo',
  imports: [LYNX_ELEMENTS, RouterLink],
  template: `
    <view
      style="display: flex; flex-direction: row; margin-top: 16px; align-self: flex-start;"
    >
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Pick photo"
        accessibility-traits="button"
        style="padding: 12px; background-color: #e0e0e0;"
        (bindtap)="pick()"
      >
        <text>Pick photo</text>
      </view>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open web view"
        accessibility-traits="button"
        style="margin-left: 8px; padding: 12px; background-color: #e0e0e0;"
        routerLink="/webview"
      >
        <text>Open web view</text>
      </view>
    </view>
    <text flatten="false" style="margin-top: 8px;">Photo: {{ status() }}</text>
  `,
})
export class PhotoRoute {
  readonly #picker = inject(LynxImagePicker);
  readonly status = signal('none');

  async pick(): Promise<void> {
    this.status.set('…');
    try {
      const picked = await this.#picker.pick({
        maxDimension: 64,
        quality: 0.8,
      });
      if (!picked) {
        this.status.set('canceled');
        return;
      }
      const { reply, bytes } = await upload(picked.blob);
      this.status.set(
        bytes === picked.blob.size && picked.name.endsWith('.jpg')
          ? `uploaded as ${reply}`
          : `${bytes} of ${picked.blob.size} bytes arrived as ${reply}, named ${picked.name}`,
      );
    } catch (error) {
      this.status.set(
        error instanceof ImagePickerError
          ? error.code
          : (error as Error).message,
      );
    }
  }
}
