/**
 * On-device crash diagnostics.
 *
 * There is no console on the Lynx device, so we capture the last unhandled
 * error/rejection into a global (`__lynxLastError`) that Angular components can
 * surface via a `<text>` element. LynxErrorHandler covers Angular-managed
 * errors; the global `onerror`/`onunhandledrejection` handlers registered here
 * catch crashes that escape Angular entirely — native glue code, promise
 * rejections outside zones, etc.
 *
 * Split out of runtime.ts so `reportToNative` (and the handlers) can be
 * unit-tested on their own, and so the diagnostic seed runs before any other
 * runtime side effect.
 */

// Seed the diagnostic slot so a read before the first crash returns '' rather
// than undefined (components render it directly into <text>).
(globalThis as any).__lynxLastError = '';

/**
 * Forward an error to the native Lynx error reporting API when it exists.
 * errorCode 1101 = ErrCode::LYNX_ERROR_CODE_LEPUS (matches React Lynx's
 * convention). No-op off-device where `_ReportError` is absent.
 */
export const reportToNative = (err: Error): void => {
  if (typeof _ReportError === 'function') {
    _ReportError(err, { errorCode: 1101 });
  }
};

// Only install our handler when the host hasn't already provided one — a real
// browser (web preview) supplies its own `onerror`, which we must not clobber.
if (typeof (globalThis as any).onerror !== 'function') {
  (globalThis as any).onerror = (
    msg: string | Event,
    _src?: string,
    _line?: number,
    _col?: number,
    err?: Error,
  ) => {
    const e = err ?? new Error(String(msg));
    (globalThis as any).__lynxLastError =
      `${e.name}: ${e.message}\n${e.stack ?? ''}`;
    reportToNative(e);
  };
}
if (typeof (globalThis as any).onunhandledrejection !== 'function') {
  (globalThis as any).onunhandledrejection = (event: PromiseRejectionEvent) => {
    const reason = event?.reason;
    const e =
      reason instanceof Error
        ? reason
        : new Error(`Unhandled rejection: ${String(reason)}`);
    (globalThis as any).__lynxLastError =
      `${e.name}: ${e.message}\n${e.stack ?? ''}`;
    reportToNative(e);
  };
}
