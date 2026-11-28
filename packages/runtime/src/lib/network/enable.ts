import { isMainThread } from '../background-call';
import { relayHttpRequest } from './http-relay';
import { setHttpRelay } from './http-relay-hook';
import {
  installBlob,
  installFetch,
  installReadableStream,
  installTextDecoder,
  installTextEncoder,
  installXMLHttpRequest,
} from './index';

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
  // HttpClient's requests skip the relayed fetch's Request, Response and
  // body stream (http-relay.ts). It checks that `fetch` is the relayed one
  // before each request, so an environment's own fetch keeps them.
  setHttpRelay(relayHttpRequest);
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

/**
 * Gives Lynx's main thread `TextEncoder` (installTextEncoder()).
 *
 * Apps don't call this: the build plugin calls it at the top of every
 * main-thread module that names `TextEncoder`, such as `@angular/localize`'s
 * message ids (see ɵenableFetch()). `fetch` brings it too.
 */
export const ɵenableTextEncoder = (): void => {
  if (__WEB__ || !isMainThread()) return;
  installTextEncoder(globalThis as unknown as Record<string, unknown>);
};

/**
 * Gives Lynx's main thread `TextDecoder` (installTextDecoder()).
 *
 * Apps don't call this: the build plugin calls it at the top of every
 * main-thread module that names `TextDecoder` (see ɵenableFetch()). `fetch`
 * brings it too.
 */
export const ɵenableTextDecoder = (): void => {
  if (__WEB__ || !isMainThread()) return;
  installTextDecoder(globalThis as unknown as Record<string, unknown>);
};

/**
 * Gives Lynx's main thread `ReadableStream` (installReadableStream()).
 *
 * Apps don't call this: the build plugin calls it at the top of every
 * main-thread module that names `ReadableStream` (see ɵenableFetch()).
 * `fetch` brings it too.
 */
export const ɵenableReadableStream = (): void => {
  if (__WEB__ || !isMainThread()) return;
  installReadableStream(globalThis as unknown as Record<string, unknown>);
};

/**
 * Gives Lynx's main thread `Blob` (installBlob()).
 *
 * Apps don't call this: the build plugin calls it at the top of every
 * main-thread module that names `Blob`, or a canvas's `toBlob()` or
 * `convertToBlob()`, which make one (see ɵenableFetch()). `fetch` and
 * LynxImagePicker bring it too.
 */
export const ɵenableBlob = (): void => {
  if (__WEB__ || !isMainThread()) return;
  installBlob(globalThis as unknown as Record<string, unknown>);
};
