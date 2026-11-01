# HTTP Requests

`HttpClient`, `httpResource`, `fetch()` and `XMLHttpRequest` work in components, services and interceptors, as in a browser app.

## Setup

```typescript
// app.config.ts
import { provideHttpClient } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    provideHttpClient(), // or provideHttpClient(withXhr()), withInterceptors([...])
  ],
};
```

```typescript
readonly posts = httpResource<Post[]>(() => `${API}/posts`);
```

## How it works

Lynx has `fetch` only on the background thread, and Angular runs on the main thread. The runtime installs `fetch`, `XMLHttpRequest`, `Headers`, `Request`, `Response`, `TextEncoder`, `TextDecoder` and `DOMException` on the main thread (`packages/runtime/src/lib/network/`). The `fetch` relays each request to the background thread's `fetch` through `callOnBackground()`, and XHR is built on it. Angular's `FetchBackend` (the default) and `HttpXhrBackend` (`withXhr()`) both use them unchanged. The web preview's main thread is a browser frame and keeps the browser's own.

## Rules

- **Absolute URLs only.** A Lynx app has no page URL, so `http.get('/api/x')` fails with a `TypeError` ("Failed to parse URL"). Prefix the base URL in a constant or an interceptor.
- **HTTPS.** `ng build --platform` apps block plain `http://` except to the device itself (`localhost`/`127.0.0.1`). Lynx Explorer allows it.
- **No CORS on device**; it still applies in the web preview.
- **Bodies:** strings, JSON, `URLSearchParams`, `ArrayBuffer`, typed arrays. `Blob`/`FormData`/stream bodies throw (Lynx has neither class). Use `responseType: 'arraybuffer'`, not `'blob'`.
- **Progress** (`reportProgress`) arrives once, when the body is complete.
- **Failures:** a request that never reaches the server is an `HttpErrorResponse` with status 0. (Lynx's HTTP service reports it as status 499 with no headers; the runtime turns that into a network error.)
- **`statusText` is `OK` for every status on iOS.** Check `status`.
- **`withCredentials` does nothing**: the host app's HTTP stack owns cookies.
- **Tests:** `provideHttpClient()` + `provideHttpClientTesting()` in `render()`'s providers, as in any Angular app.
- **Host app** needs Lynx's HTTP service (Lynx Explorer and `ng build --platform` apps have it).
- **Lynx's own `fetch` in a `backgroundFn()`:** up to Lynx 4.2, its `Headers` matches names by exact spelling. Write `Content-Type` that way: Lynx misses `content-type` and adds a second, `text/plain;charset=UTF-8` one, which iOS may send instead of yours and Android sends as well. Read response headers in both cases, since iOS capitalizes their names and Android lowercases them. The main thread's `fetch`, XHR and `HttpClient` do both for you.

## Sign in through a web page

OAuth and OpenID Connect sign-in runs on a provider's page that redirects back with a code or token. Lynx has no popups or redirects, so `LynxWebAuthSession` opens the page in the platform's sign-in sheet (`ASWebAuthenticationSession` on iOS, a Custom Tab on Android) and resolves with the URL it redirects to on your app's scheme:

```typescript
import { inject } from '@angular/core';
import { LynxWebAuthSession, WebAuthSessionError } from '@blotch/angular-lynx';

readonly #webAuth = inject(LynxWebAuthSession);

async signIn(): Promise<string | null> {
  try {
    const callback = await this.#webAuth.start({
      url: 'https://auth.example.com/authorize?client_id=…&redirect_uri=com.example.notes:/oauth',
      callbackScheme: 'com.example.notes',
    });
    return new URL(callback).searchParams.get('code');
  } catch (error) {
    if (error instanceof WebAuthSessionError && error.code === 'canceled') return null;
    throw error;
  }
}
```

- **Android** opens the app from the redirect like any link: add the scheme to `deepLinkSchemes` in the `build` target's options in `angular.json`. iOS needs nothing.
- **`ephemeral: true`** signs in without the browser's cookies and keeps none (iOS only; Custom Tabs share Chrome's).
- **Rejects with `WebAuthSessionError`**, whose `code` is `canceled` (closed, or declined on iOS), `unavailable` or `failed` (couldn't open the page, or a sign-in is already open).
- **`unavailable` everywhere but `ng build --platform` apps:** Lynx Explorer, the web preview and tests have no native module for it. Your own native app (or an ejected project from before it) registers an `AngularLynxWebAuth` module itself: see the website's "Embed in a Native App" guide.
