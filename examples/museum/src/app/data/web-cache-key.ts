import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { LynxSystemInfo } from '@blotch/angular-lynx';
import { API } from './artwork';

/**
 * Gives the web preview's requests to the museum URLs of their own.
 *
 * The API's cache keeps one copy of each URL, made by the first request
 * for it, whatever that request's Origin: a copy made for a request
 * without one (the iOS and Android apps send none) has no
 * Access-Control-Allow-Origin header, and a browser then refuses every
 * answer from it until it expires. With `client=web` on the browser's
 * requests, only browsers, which always send an Origin, make those copies.
 * The API ignores the parameter.
 *
 * An HttpInterceptor, as on the web: Angular's HttpClient runs on Lynx
 * whole, interceptors and all.
 */
export const webCacheKey: HttpInterceptorFn = (request, next) => {
  const web = String(inject(LynxSystemInfo).platform).toLowerCase() === 'web';
  return web && request.url.startsWith(API)
    ? next(request.clone({ setParams: { client: 'web' } }))
    : next(request);
};
