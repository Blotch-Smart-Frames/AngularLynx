import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BarcodeScannerError,
  ImagePickerError,
  LYNX_ELEMENTS,
  LynxBarcodeScanner,
  LynxImagePicker,
  LynxPhotoLibrary,
  PhotoLibraryError,
} from '@blotch/angular-lynx';

/**
 * An 8x8 red PNG for "Save": the photo library takes only an image it can
 * read, and the fixture has no canvas to make one with.
 */
const RED_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08, 0x08, 0x02,
  0x00, 0x00, 0x00, 0x4b, 0x6d, 0x29, 0xdc, 0x00, 0x00, 0x00, 0x11, 0x49, 0x44,
  0x41, 0x54, 0x78, 0xda, 0x63, 0x78, 0xe0, 0xe0, 0x80, 0x15, 0x31, 0x0c, 0x2d,
  0x09, 0x00, 0x8a, 0xc6, 0x58, 0x01, 0xbc, 0x3b, 0x52, 0xd4, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

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
 * screen, so there's no room for another there. "Open video", under the
 * status, opens video-toggle.ts: the row has no room for it either. "Scan
 * code", beside it, opens LynxBarcodeScanner (see scan()), and "Save",
 * beside that, saves a photo with LynxPhotoLibrary (see save()).
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
    <view
      style="display: flex; flex-direction: row; margin-top: 8px; align-self: flex-start;"
    >
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open video"
        accessibility-traits="button"
        style="padding: 12px; background-color: #e0e0e0;"
        routerLink="/video-toggle"
      >
        <text>Open video</text>
      </view>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Scan code"
        accessibility-traits="button"
        style="margin-left: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="scan()"
      >
        <text>Scan code</text>
      </view>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Save"
        accessibility-traits="button"
        style="margin-left: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="save()"
      >
        <text>Save</text>
      </view>
    </view>
    <text flatten="false" style="margin-top: 8px;">Scan: {{ scanned() }}</text>
    <text flatten="false" style="margin-top: 8px;">Saved: {{ saved() }}</text>
  `,
})
export class PhotoRoute {
  readonly #picker = inject(LynxImagePicker);
  readonly #scanner = inject(LynxBarcodeScanner);
  readonly #photos = inject(LynxPhotoLibrary);
  readonly status = signal('none');
  readonly scanned = signal('none');
  readonly saved = signal('none');

  /**
   * Saves RED_PNG to the photo library with LynxPhotoLibrary (issue #927),
   * which the app has because the harness gives it `permissions.savePhotos`
   * (addSavePhotosPermission in src/scaffold.ts). Shows "Saved: yes" once
   * the shell's module answers with the new photo's ID, or the error's code
   * and message (native/save-photo.yaml).
   */
  async save(): Promise<void> {
    this.saved.set('…');
    try {
      const id = await this.#photos.save({
        blob: new Blob([RED_PNG], { type: 'image/png' }),
        name: 'e2e-red.png',
      });
      this.saved.set(id ? 'yes' : 'no ID');
    } catch (error) {
      this.saved.set(
        error instanceof PhotoLibraryError
          ? `${error.code}, ${error.message}`
          : (error as Error).message,
      );
    }
  }

  /**
   * Opens LynxBarcodeScanner (issue #917), which the app has because the
   * harness gives it the camera permission (addCameraPermission in
   * src/scaffold.ts). The iOS Simulator has no camera, so the shell's
   * module answers that the device has no scanner: its message, rather than
   * the runtime's for a host without the module, shows the shell registered
   * it (native/scanner.yaml).
   */
  async scan(): Promise<void> {
    this.scanned.set('…');
    try {
      const code = await this.#scanner.scan({ formats: ['qr'] });
      this.scanned.set(`${code.format} ${code.value}`);
    } catch (error) {
      this.scanned.set(
        error instanceof BarcodeScannerError
          ? `${error.code}, ${error.message}`
          : (error as Error).message,
      );
    }
  }

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
