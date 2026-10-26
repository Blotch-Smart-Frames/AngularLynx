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
