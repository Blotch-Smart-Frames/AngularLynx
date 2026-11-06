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

Lynx has `fetch` only on the background thread, and Angular runs on the main thread. The runtime installs `fetch`, `XMLHttpRequest`, `Headers`, `Request`, `Response`, `ReadableStream`, `TextEncoder` and `TextDecoder` on the main thread, and `atob`, `btoa` and `DOMException` on both threads (`packages/runtime/src/lib/network/`). The `fetch` relays each request to the background thread's `fetch` through `callOnBackground()`, and XHR is built on it. Angular's `FetchBackend` (the default) and `HttpXhrBackend` (`withXhr()`) both use them unchanged. The web preview's main thread is a browser frame and keeps the browser's own.

## Rules

- **Absolute URLs only.** A Lynx app has no page URL, so `http.get('/api/x')` fails with a `TypeError` ("Failed to parse URL"). Prefix the base URL in a constant or an interceptor. The exception: a `GET` of a file the app bundles, by its path in `dist/` (`/static/image/logo.png`, or a `.glb` copied in with `output.copy` in `lynx.config.ts`), loads in an `ng build --platform` app, which reads it from the app, whether it's given as a string or a `Request` (`new Request('/static/model.glb').url` stays the path). `ng serve` makes imported files' URLs absolute anyway. Any other request for a relative URL rejects with a `TypeError`. There's no loader for `import model from './model.glb'` (the build fails), and `new URL('./model.glb', import.meta.url)` throws on Lynx. `data:` and object URLs (`URL.createObjectURL()`) need no request.
- **HTTPS.** `ng build --platform` apps block plain `http://` except to the device itself (`localhost`/`127.0.0.1`). Lynx Explorer allows it.
- **No CORS on device**; it still applies in the web preview.
- **Bodies:** strings, JSON, `URLSearchParams`, `ArrayBuffer`, typed arrays and `Blob` (the runtime adds `Blob` to the main thread). `FormData` and stream request bodies throw. `responseType: 'blob'` works; `new Response(stream)` reads the stream when its body is read.
- **Progress** (`reportProgress`) arrives once, when the body is complete.
- **Responses arrive whole.** `response.body` is a `ReadableStream`, but it yields the whole body as one chunk once the response has ended. A response that stays open, such as server-sent events, never arrives. Firebase Firestore detects this and switches to long polling by itself.
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

## Open links outside the app

Lynx has no `<a href>`, `window.open` or `location`, so a link can't leave the app by itself. `LynxLinking` hands it to the phone:

```typescript
import { inject } from '@angular/core';
import { LinkingError, LynxLinking } from '@blotch/angular-lynx';

readonly #linking = inject(LynxLinking);

async openHelp(): Promise<void> {
  // A browser sheet over the app; resolves once the person is back.
  await this.#linking.openInApp('https://example.com/help', { toolbarColor: '#18181b' });
  // Refresh anything the page may have changed here.
}

async emailSupport(): Promise<void> {
  try {
    await this.#linking.openURL('mailto:support@example.com');
  } catch (error) {
    if (error instanceof LinkingError && error.code === 'failed') {
      // No mail app on this phone.
    }
  }
}
```

- **`openURL(url)`** opens the URL where the phone opens it: `https` in the browser (or the app that claims the link), `mailto:` in the mail app, `tel:` in the phone app, another app's scheme in that app. Resolves once handed over; rejects with `LinkingError` `failed` when nothing opens it.
- **`openInApp(url, { toolbarColor?, controlsColor? })`** shows an `http`/`https` page in `SFSafariViewController` (iOS) or a Custom Tab (Android). It resolves when the sheet closes on iOS, and when the app comes back to the front on Android (Android doesn't report a Custom Tab closing). Any other scheme rejects with a `TypeError`. Colors are hex or comma `rgb()`/`rgba()`; `controlsColor` is iOS only. Not for sign-in: use `LynxWebAuthSession`, which returns the redirect.
- **`canOpenURL(url)`** resolves whether something on the phone opens the URL. iOS and Android 11+ answer only for schemes the app declares: list them in `canOpenURLSchemes` in the `build` target's options (`["whatsapp"]`, scheme alone, at most 50 with the built-in ones), which `ng build --platform` writes into `LSApplicationQueriesSchemes` and the manifest's `<queries>`. `http`, `https`, `mailto`, `tel` and `sms` are always declared. `openURL()` needs no declaration.
- **Relative URLs throw a `TypeError`**: give the scheme.
- **Web preview:** both open a new tab (call them from a tap handler, before any `await`, or the browser blocks the tab); `openInApp()` resolves when the tab closes or the app's tab is shown again; `canOpenURL()` resolves `true`.
- **Lynx Explorer:** no native module, so `openURL()`/`openInApp()` reject with `LinkingError` `unavailable`, and `canOpenURL()` resolves `false`. Your own native app registers an `AngularLynxLinking` module itself (website's "Embed in a Native App" guide).
- **Specs:** the testing library records each URL instead of opening it: `openedURLs()` returns `[{ url, inApp }]` for the current test, and `canOpenURL()` resolves `true`.
