import { isMainThread } from '../background-call';
import { installFetch, installXMLHttpRequest } from './index';

/**
 * Gives Lynx's main thread `fetch`, with `Headers`, `Request` and `Response`
 * (installFetch()).
 *
 * Apps don't call this: the build plugin calls it at the top of every
 * main-thread module that names one of them, such as `@angular/common/http`'s
 * `FetchBackend` or a library's `fetch(url)`, so the relayed `fetch` is in
 * the bundle only when something can call it. PrimJS reads a script's whole
 * bytecode as it loads it, so every app used to pay for it in memory (#719).
 * A module that reaches it by a name built at runtime
 * (`globalThis['fe' + 'tch']`) can call this first. Calling it again changes
 * nothing.
 *
 * On Lynx for Web the main thread is a browser frame, which has its own, so
 * there it does nothing and the build drops the runtime's. The background
 * thread has Lynx's own `fetch`.
 */
export const ɵenableFetch = (): void => {
  if (__WEB__ || !isMainThread()) return;
  installFetch(globalThis as unknown as Record<string, unknown>);
};

/**
 * Gives Lynx's main thread `XMLHttpRequest`, and the `fetch` it sends each
 * request through (installXMLHttpRequest()).
 *
 * Apps don't call this: the build plugin calls it at the top of every
 * main-thread module that names `XMLHttpRequest`, such as
 * `@angular/common/http`'s `HttpXhrBackend` (see ɵenableFetch()).
 */
export const ɵenableXMLHttpRequest = (): void => {
  if (__WEB__ || !isMainThread()) return;
  installXMLHttpRequest(globalThis as unknown as Record<string, unknown>);
};
