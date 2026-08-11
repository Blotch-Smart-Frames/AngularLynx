import { type ErrorHandler, Injectable } from '@angular/core';

/**
 * Angular ErrorHandler that routes errors to the native Lynx error reporting API.
 *
 * Automatically provided by provideRenderer(). Also writes to __lynxLastError
 * so components can surface errors as <text> elements (no console on device).
 */
@Injectable()
export class LynxErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));

    // Keep the on-device debug string up-to-date.
    (globalThis as any).__lynxLastError =
      `${err.name}: ${err.message}\n${err.stack ?? ''}`;

    // errorCode 1101 = ErrCode::LYNX_ERROR_CODE_LEPUS (matches React Lynx convention).
    if (typeof _ReportError === 'function') {
      _ReportError(err, { errorCode: 1101 });
    }
  }
}
