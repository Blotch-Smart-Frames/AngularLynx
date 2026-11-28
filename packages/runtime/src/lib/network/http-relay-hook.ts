import type { HttpInterceptorFn } from '@angular/common/http';

/**
 * Where provideRenderer() plugs HttpClient's relay in (http-relay.ts).
 *
 * The relay's code is in an app only when the app's code can send a request:
 * ɵenableFetch(), which the build plugin calls in each module that names
 * `provideHttpClient` or `fetch` (network/enable.ts), sets it here. PrimJS
 * reads a script's whole bytecode as it loads it, so an app without
 * HttpClient shouldn't carry it (#719). provideRenderer(), which every app
 * has, only provides this interceptor, which passes every request on until
 * then.
 */
let relay: HttpInterceptorFn | undefined;

/**
 * Sets the interceptor that relays HttpClient's requests.
 *
 * @param fn - The relay's interceptor.
 */
export const setHttpRelay = (fn: HttpInterceptorFn): void => {
  relay = fn;
};

/**
 * One of HttpClient's root interceptors, which sends a request through the
 * relay once ɵenableFetch() has set it, and passes it on otherwise.
 *
 * @param request - The request.
 * @param next - The rest of HttpClient's chain.
 * @returns The request's events.
 */
export const httpRelayInterceptor: HttpInterceptorFn = (request, next) =>
  relay ? relay(request, next) : next(request);
