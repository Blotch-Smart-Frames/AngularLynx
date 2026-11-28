import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';

/**
 * The native module of the apps `ng build --platform` makes
 * (`BarcodeScannerModule.swift` and `BarcodeScannerModule.kt` in
 * `packages/native/templates`), which only an app whose angular.json sets
 * `permissions.camera` has.
 */
const BARCODE_SCANNER_MODULE = 'AngularLynxBarcodeScanner';

/**
 * The kinds of code {@link LynxBarcodeScanner} reads, which both platforms'
 * scanners know: the two-dimensional `qr`, `aztec`, `dataMatrix` and
 * `pdf417`, and the linear `ean13`, `ean8`, `upcA`, `upcE`, `code39`,
 * `code93`, `code128`, `itf` and `codabar`.
 */
export type BarcodeFormat =
  | 'qr'
  | 'aztec'
  | 'dataMatrix'
  | 'pdf417'
  | 'ean13'
  | 'ean8'
  | 'upcA'
  | 'upcE'
  | 'code39'
  | 'code93'
  | 'code128'
  | 'itf'
  | 'codabar';

/** Every {@link BarcodeFormat}, which a scan looks for when it's given none. */
export const BARCODE_FORMATS: readonly BarcodeFormat[] = [
  'qr',
  'aztec',
  'dataMatrix',
  'pdf417',
  'ean13',
  'ean8',
  'upcA',
  'upcE',
  'code39',
  'code93',
  'code128',
  'itf',
  'codabar',
];

/** A code {@link LynxBarcodeScanner.scan} read. */
export type BarcodeScan = {
  /** The kind of code it was. */
  readonly format: BarcodeFormat;
  /**
   * What the code holds, as text: a URL, a ticket number, a Wi-Fi network's
   * `WIFI:S:…;;` and so on. The app reads what it means.
   */
  readonly value: string;
};

/** What {@link LynxBarcodeScanner.scan} looks for. */
export type BarcodeScanOptions = {
  /**
   * The kinds of code to read; any other is ignored. Every
   * {@link BarcodeFormat} when it's left out. Fewer kinds read faster and
   * misread less, so name the ones the app expects.
   */
  readonly formats?: readonly BarcodeFormat[];
};

/**
 * Why a scan read no code:
 * - `canceled`: the person closed the scanner.
 * - `unavailable`: the host has no scanner. Only the apps
 *   `ng build --platform` makes with `permissions.camera` in angular.json
 *   have one, on an iPhone from iOS 16 with an A12 chip or later, and on an
 *   Android phone with Google Play services. Lynx Explorer, the web preview
 *   and the iOS Simulator have none.
 * - `denied`: the person, or a restriction such as Screen Time, doesn't let
 *   the app use the camera, or on Android doesn't let Google Play services,
 *   which shows the camera there, use it.
 * - `failed`: the scanner couldn't start or stopped, or a scan was already
 *   open.
 */
export type BarcodeScannerErrorCode =
  | 'canceled'
  | 'unavailable'
  | 'denied'
  | 'failed';

/** The error a {@link LynxBarcodeScanner} rejects with. */
export class BarcodeScannerError extends Error {
  constructor(
    readonly code: BarcodeScannerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BarcodeScannerError';
  }
}

/**
 * How a scan ended, as the native module reports it: the code read, or why
 * none was.
 */
type ScanResult = {
  readonly format?: string;
  readonly value?: string;
  readonly error?: string;
  readonly message?: string;
};

const ERROR_CODES: readonly BarcodeScannerErrorCode[] = [
  'canceled',
  'unavailable',
  'denied',
  'failed',
];

const DEFAULT_MESSAGES: Record<BarcodeScannerErrorCode, string> = {
  canceled: 'The scan was canceled.',
  unavailable:
    'This host has no barcode scanner. Only the apps `ng build --platform` makes with `permissions.camera` in angular.json have one.',
  denied: "The app isn't allowed to use the camera.",
  failed: 'The scanner could not read a code.',
};

/**
 * Reads a QR code or a barcode with the camera, using the platform's own
 * scanner, so the app needn't build a camera screen: VisionKit's
 * DataScannerViewController on iOS, and Google's code scanner, from Google
 * Play services, on Android. The scanner opens over the app and closes once
 * it reads a code.
 *
 * It's opt-in: the native code behind it is only in an app whose angular.json
 * sets `permissions.camera`, the reason iOS shows when it asks for the
 * camera. Elsewhere, such as Lynx Explorer, the web preview and the iOS
 * Simulator, `scan()` rejects with `unavailable`. Under the testing library,
 * a scan waits for the spec to answer it with `queueBarcodeScan()`,
 * `cancelBarcodeScan()` or `failBarcodeScan()`. Android's scanner runs in
 * Play services rather than the app, so the app needs no camera permission
 * there.
 *
 * @usageNotes
 * ```jsonc
 * // angular.json, in the build target's options
 * "permissions": { "camera": "Scan your ticket" }
 * ```
 *
 * ```typescript
 * const scanner = inject(LynxBarcodeScanner);
 *
 * try {
 *   const code = await scanner.scan({ formats: ['qr'] });
 *   this.ticket.set(code.value);
 * } catch (error) {
 *   if (error instanceof BarcodeScannerError && error.code === 'canceled') return;
 *   throw error;
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxBarcodeScanner {
  /**
   * Opens the scanner and resolves with the first code it reads. Rejects
   * with a {@link BarcodeScannerError}.
   */
  async scan({
    formats = BARCODE_FORMATS,
  }: BarcodeScanOptions = {}): Promise<BarcodeScan> {
    // An empty list would read nothing and never close by itself, so it's
    // treated as the app not choosing.
    const requested = formats.length > 0 ? [...formats] : BARCODE_FORMATS;
    let result: ScanResult | undefined;
    try {
      // The module calls back on the background thread, where NativeModules
      // lives; callNativeModuleAsync keeps the callback there, so nothing
      // stays registered on either thread once it answers, however many
      // scans the app makes.
      result = (await callOnBackground(
        'callNativeModuleAsync',
        BARCODE_SCANNER_MODULE,
        'scan',
        [{ formats: requested }],
      )) as ScanResult | undefined;
    } catch {
      throw new BarcodeScannerError(
        'unavailable',
        DEFAULT_MESSAGES.unavailable,
      );
    }
    if (result?.value !== undefined && result.format !== undefined) {
      return { format: result.format as BarcodeFormat, value: result.value };
    }
    const code = ERROR_CODES.includes(result?.error as BarcodeScannerErrorCode)
      ? (result?.error as BarcodeScannerErrorCode)
      : 'failed';
    throw new BarcodeScannerError(
      code,
      result?.message ?? DEFAULT_MESSAGES[code],
    );
  }
}
