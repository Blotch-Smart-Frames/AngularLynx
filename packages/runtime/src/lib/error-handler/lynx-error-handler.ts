import {
  type ErrorDetails,
  type ErrorHandler,
  Injectable,
} from '@angular/core';

/**
 * Keep the on-device debug string up-to-date. There is no console on device,
 * so components surface this global via a `<text>` element.
 */
const recordLastError = (err: Error): void => {
  (globalThis as any).__lynxLastError =
    `${err.name}: ${err.message}\n${err.stack ?? ''}`;
};

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
    recordLastError(err);

    // errorCode 1101 = ErrCode::LYNX_ERROR_CODE_LEPUS (matches React Lynx convention).
    if (typeof _ReportError === 'function') {
      _ReportError(err, { errorCode: 1101 });
    }
  }

  /**
   * Called by Angular for rendering errors caught by an `@boundary` block.
   *
   * Without this override Angular falls back to `handleError`, which reports a
   * fatal LEPUS error — on device that raises the red error overlay even though
   * the boundary already swapped in its `@error` fallback and the app is still
   * usable. A caught error is recoverable by definition, so it goes to
   * `lynx.reportError` at `warning` level instead: monitoring still sees it,
   * but it isn't treated as a crash.
   *
   * Angular calls this synchronously mid-render, so it must not write to
   * signals (NG0600) — it only touches a plain global and the native bridge.
   */
  onViewError(error: Error, _details: ErrorDetails): void {
    recordLastError(error);

    // `lynx` only exists inside the Lynx runtime (not in Node tests or SSR),
    // and `reportError` needs background-thread 2.3+ / main-thread 3.0+.
    if (typeof lynx !== 'undefined' && typeof lynx.reportError === 'function') {
      lynx.reportError(error, { level: 'warning' });
    }
  }
}
