import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BarcodeScannerError,
  ImagePickerError,
  LYNX_ELEMENTS,
  LynxBarcodeScanner,
  LynxImagePicker,
  LynxMotion,
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
 * screen, so there's no room for another there. "Open video", under the
 * status, opens video-toggle.ts: the row has no room for it either. "Scan
 * code", beside it, opens LynxBarcodeScanner (see scan()).
 *
 * "Motion", before the scan's status on the last row CI's emulator shows,
 * reads the phone's motion sensors with LynxMotion (issue #920), which the
 * app has because the harness sets angular.json's `motion`. A tap shows the
 * size of the first acceleration it samples in m/s², gravity included, so
 * `Motion: 9.8` on a phone at rest, or `Motion: none` without an
 * accelerometer. The Android emulator has one, so native/motion.yaml sees a
 * sample come through the shell's module and its event; the iOS Simulator
 * has none. The scan's status takes the rest of the row, and wraps there:
 * only the iOS flow reads it, on a wider screen.
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
    </view>
    <view style="display: flex; flex-direction: row; margin-top: 8px;">
      <text flatten="false" (bindtap)="readMotion()"
        >Motion: {{ motion() }}</text
      >
      <text flatten="false" style="margin-left: 16px; flex: 1;"
        >Scan: {{ scanned() }}</text
      >
    </view>
  `,
})
export class PhotoRoute {
  readonly #picker = inject(LynxImagePicker);
  readonly #scanner = inject(LynxBarcodeScanner);
  readonly #motion = inject(LynxMotion);
  readonly motion = signal('tap');
  readonly status = signal('none');
  readonly scanned = signal('none');

  /**
   * Opens LynxBarcodeScanner (issue #917), which the app has because the
   * harness gives it the camera permission (addCameraPermission in
   * src/scaffold.ts). The iOS Simulator has no camera, so the shell's
   * module answers that the device has no scanner: its message, rather than
   * the runtime's for a host without the module, shows the shell registered
   * it (native/scanner.yaml).
   */
  readMotion(): void {
    this.motion.set('…');
    void this.#motion.availability().then(({ acceleration }) => {
      if (!acceleration) {
        this.motion.set('none');
        return;
      }
      const stop = this.#motion.watchAcceleration(({ x, y, z }) => {
        stop();
        this.motion.set(Math.hypot(x, y, z).toFixed(1));
      });
    });
  }

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
