/**
 * LynxBarcodeScanner in rendered specs (issue #917).
 *
 * There's no camera to point in a spec, so the setup file gives the
 * environment a scanner module whose scans the spec answers with
 * queueBarcodeScan(), cancelBarcodeScan() or failBarcodeScan(). The answers
 * go through the background thread, as the shells' do.
 */

import { Component, inject, signal } from '@angular/core';
import {
  BarcodeScannerError,
  LYNX_ELEMENTS,
  LynxBarcodeScanner,
} from '@blotch/angular-lynx';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cancelBarcodeScan,
  failBarcodeScan,
  fireEvent,
  queueBarcodeScan,
  render,
  screen,
  waitForUpdate,
} from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'check-in',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="scan()"><text>Scan ticket</text></view>
    <text>{{ status() }}</text>
  `,
})
class CheckIn {
  readonly #scanner = inject(LynxBarcodeScanner);
  readonly status = signal('Not scanned');

  async scan(): Promise<void> {
    this.status.set('Scanning');
    try {
      const code = await this.#scanner.scan({ formats: ['qr'] });
      this.status.set(`${code.format}: ${code.value}`);
    } catch (error) {
      this.status.set(
        error instanceof BarcodeScannerError
          ? `Error: ${error.code}, ${error.message}`
          : 'Error',
      );
    }
  }
}

describe('LynxBarcodeScanner under the testing library', () => {
  it('resolves with a code queued before the scan opened', async () => {
    await render(CheckIn);
    queueBarcodeScan({ format: 'qr', value: 'TICKET-42' });

    fireEvent.tap(screen.getByText('Scan ticket'));
    await settle();

    expect(screen.getByText('qr: TICKET-42')).toBeInTheDocument();
  });

  it('keeps the scan open until a code is queued', async () => {
    await render(CheckIn);

    fireEvent.tap(screen.getByText('Scan ticket'));
    await settle();
    expect(screen.getByText('Scanning')).toBeInTheDocument();

    queueBarcodeScan({ format: 'qr', value: 'TICKET-7' });
    await settle();
    expect(screen.getByText('qr: TICKET-7')).toBeInTheDocument();
  });

  it('answers the scans in turn', async () => {
    await render(CheckIn);
    queueBarcodeScan({ format: 'qr', value: 'first' });
    queueBarcodeScan({ format: 'qr', value: 'second' });

    fireEvent.tap(screen.getByText('Scan ticket'));
    await settle();
    expect(screen.getByText('qr: first')).toBeInTheDocument();

    fireEvent.tap(screen.getByText('Scan ticket'));
    await settle();
    expect(screen.getByText('qr: second')).toBeInTheDocument();
  });

  it('rejects with canceled when the spec closes the scanner', async () => {
    await render(CheckIn);

    fireEvent.tap(screen.getByText('Scan ticket'));
    await settle();
    cancelBarcodeScan();
    await settle();

    expect(
      screen.getByText('Error: canceled, The scan was canceled.'),
    ).toBeInTheDocument();
  });

  it('rejects with the failure the spec gives', async () => {
    await render(CheckIn);
    failBarcodeScan('denied');

    fireEvent.tap(screen.getByText('Scan ticket'));
    await settle();

    expect(
      screen.getByText(
        "Error: denied, The app isn't allowed to use the camera.",
      ),
    ).toBeInTheDocument();
  });

  it("passes on the failure's message", async () => {
    await render(CheckIn);
    failBarcodeScan('unavailable', 'No camera here.');

    fireEvent.tap(screen.getByText('Scan ticket'));
    await settle();

    expect(
      screen.getByText('Error: unavailable, No camera here.'),
    ).toBeInTheDocument();
  });

  it('rejects a second scan while one is open', async () => {
    const { componentRef } = await render(CheckIn);
    const scanner = componentRef.injector.get(LynxBarcodeScanner);

    const first = scanner.scan().catch((error: BarcodeScannerError) => error);
    const second = scanner.scan().catch((error: BarcodeScannerError) => error);
    await settle();

    expect(await second).toMatchObject({
      code: 'failed',
      message: 'A scan is already open.',
    });
    cancelBarcodeScan();
    expect(await first).toMatchObject({ code: 'canceled' });
  });

  describe('outside the environment', () => {
    let env: unknown;
    afterEach(() => {
      (globalThis as any).lynxTestingEnv = env;
    });

    it('says the setup file is missing', () => {
      env = (globalThis as any).lynxTestingEnv;
      (globalThis as any).lynxTestingEnv = undefined;

      expect(() => queueBarcodeScan({ format: 'qr', value: 'x' })).toThrowError(
        /queueBarcodeScan\(\) needs the testing library/,
      );
    });
  });
});
