import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxNativeModule } from '../native-module/native-module';
import {
  BARCODE_FORMATS,
  type BarcodeScan,
  type BarcodeScannerErrorCode,
  BarcodeScannerError,
  LynxBarcodeScanner,
} from './barcode-scanner';

type Done = (result: {
  format?: string;
  value?: string;
  error?: string;
  message?: string;
}) => void;

const createScanner = () =>
  Injector.create({
    providers: [LynxBarcodeScanner, LynxNativeModule],
  }).get(LynxBarcodeScanner);

/**
 * Stands in for the shells' AngularLynxBarcodeScanner module, as the
 * background thread sees it. `finish` ends the open scan the way the
 * platform would.
 */
const stubModule = () => {
  let done: Done | undefined;
  const scan = vi.fn((_request: unknown, callback: Done) => {
    done = callback;
  });
  vi.stubGlobal('NativeModules', { AngularLynxBarcodeScanner: { scan } });
  return { scan, finish: (result: Parameters<Done>[0]) => done?.(result) };
};

const rejection = async (
  promise: Promise<BarcodeScan>,
): Promise<{ code: BarcodeScannerErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BarcodeScannerError);
  const { code, message } = error as BarcodeScannerError;
  return { code, message };
};

describe('LynxBarcodeScanner', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the scanner for the formats asked for and resolves with the code it reads', async () => {
    const { scan, finish } = stubModule();

    const code = createScanner().scan({ formats: ['qr', 'ean13'] });
    await vi.waitFor(() => expect(scan).toHaveBeenCalled());
    finish({ format: 'qr', value: 'WIFI:S:Home;T:WPA;P:secret;;' });

    await expect(code).resolves.toEqual({
      format: 'qr',
      value: 'WIFI:S:Home;T:WPA;P:secret;;',
    });
    expect(scan).toHaveBeenCalledWith(
      { formats: ['qr', 'ean13'] },
      expect.any(Function),
    );
  });

  it.each<[string, { formats?: [] } | undefined]>([
    ['no options', undefined],
    ['an empty list', { formats: [] }],
  ])('looks for every format given %s', async (_, options) => {
    const { scan } = stubModule();

    void createScanner().scan(options);

    await vi.waitFor(() =>
      expect(scan).toHaveBeenCalledWith(
        { formats: BARCODE_FORMATS },
        expect.any(Function),
      ),
    );
  });

  it.each<[string, BarcodeScannerErrorCode, string]>([
    ['canceled', 'canceled', 'The scan was canceled.'],
    ['denied', 'denied', "The app isn't allowed to use the camera."],
    ['failed', 'failed', 'The scanner could not read a code.'],
    ['unavailable', 'unavailable', 'This host has no barcode scanner.'],
    ['something new', 'failed', 'The scanner could not read a code.'],
  ])(
    'rejects with the code for %s when the platform reports it',
    async (error, code, message) => {
      const { scan, finish } = stubModule();

      const scanned = createScanner().scan();
      await vi.waitFor(() => expect(scan).toHaveBeenCalled());
      finish({ error });

      const rejected = await rejection(scanned);
      expect(rejected.code).toBe(code);
      expect(rejected.message).toContain(message);
    },
  );

  it("passes on the platform's own message", async () => {
    const { scan, finish } = stubModule();

    const scanned = createScanner().scan();
    await vi.waitFor(() => expect(scan).toHaveBeenCalled());
    finish({ error: 'failed', message: 'A scan is already open.' });

    expect(await rejection(scanned)).toEqual({
      code: 'failed',
      message: 'A scan is already open.',
    });
  });

  it('rejects as unavailable where the host has no module', async () => {
    vi.stubGlobal('NativeModules', {});

    const { code } = await rejection(createScanner().scan());

    expect(code).toBe('unavailable');
  });

  it('rejects as unavailable when the main thread has no background thread to relay to', async () => {
    vi.stubGlobal('__MAIN_THREAD__', true);
    vi.stubGlobal('lynx', {
      getJSContext: () => {
        throw new Error('no background thread');
      },
    });

    const { code } = await rejection(createScanner().scan());

    expect(code).toBe('unavailable');
  });

  it('rejects as unavailable outside Lynx', async () => {
    const { code } = await rejection(createScanner().scan());

    expect(code).toBe('unavailable');
  });
});
