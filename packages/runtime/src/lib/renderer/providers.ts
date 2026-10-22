import { APP_BASE_HREF, IMAGE_CONFIG } from '@angular/common';
import {
  DOCUMENT,
  ErrorHandler,
  type EnvironmentProviders,
  makeEnvironmentProviders,
  RendererFactory2,
} from '@angular/core';
import { LynxErrorHandler } from '../error-handler/lynx-error-handler';
import { LynxDocument } from '../lynx-document';
import { LynxHydrateDocument } from '../ssr/hydrate-document';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { LYNX_DOCUMENT } from './token';

/**
 * Central DI configuration for the Lynx renderer. Must be included in every
 * Lynx Angular app's providers (typically via app.config.ts). Sets up:
 * 1. The document (LynxDocument, or LynxHydrateDocument for SSR)
 * 2. DOCUMENT stub (Angular requires this token but Lynx has no DOM Document)
 * 3. APP_BASE_HREF (prevents BrowserPlatformLocation from crashing)
 * 4. Renderer factory (creates LynxRenderer / EmulatedLynxRenderer)
 * 5. Error handler (routes to _ReportError + __lynxLastError)
 */
export const provideRenderer = (): EnvironmentProviders => {
  return makeEnvironmentProviders([
    {
      provide: LYNX_DOCUMENT,
      useFactory: () => {
        // Angular runs on the main thread only (see bootstrapApplication), so
        // the document always creates native elements: through PAPI, or by
        // reusing the snapshot's while SSR hydrates.
        // `__ENABLE_SSR__` is a build-time `define` — `false` in the Vitest
        // config, so the SSR-hydrating branch is dead code from the test
        // bundle's point of view. LynxHydrateDocument itself is covered by
        // hydrate-document.test.ts.
        /* v8 ignore next 6 */
        if (__ENABLE_SSR__ && (globalThis as any).__LYNX_IS_HYDRATING__) {
          return new LynxHydrateDocument(
            (globalThis as any).__LYNX_HYDRATE_PAGE__,
            (globalThis as any).__LYNX_HYDRATE_QUEUE__,
          );
        }
        return new LynxDocument();
      },
    },
    {
      // Angular's internal code occasionally accesses @Inject(DOCUMENT). In Lynx
      // there is no DOM document, so we provide a minimal stub. Specific access
      // points (defaultView, querySelector) on the global `document` are
      // polyfilled in polyfills.ts.
      provide: DOCUMENT,
      useValue: {
        // TransferState's root factory calls
        // `inject(DOCUMENT).getElementById(APP_ID + '-state')` to restore the
        // `<script>` that Angular SSR inlines. `resource()` and `httpResource()`
        // inject TransferState on construction, so without this every resource
        // threw "getElementById is not a function". Lynx never has that script
        // (AngularLynx SSR hydrates from its own element snapshot), so `null` —
        // "no transferred state" — is the correct answer, not just a stub.
        getElementById: () => null,
      },
    },
    // Provide a base href so Angular's PathLocationStrategy uses it directly
    // instead of calling getBaseHrefFromDOM(), which crashes in Lynx because
    // BrowserPlatformLocation (platform-level) tries to querySelector on an
    // undefined DOCUMENT.
    {
      provide: APP_BASE_HREF,
      useValue: '/',
    },
    // Disable Angular's ImagePerformanceWarning. It runs on every bootstrap and,
    // unless *both* warnings are disabled, calls Angular's internal getDocument()
    // to scan the page for oversized/lazy <img> elements. Lynx has no DOM
    // document — getDocument() throws NG0210 and aborts the whole bootstrap.
    //
    // This only bites the *web* runtime: ImagePerformanceWarning.start() early-
    // returns when `PerformanceObserver` is undefined, which is the case in
    // native Lynx's JS engines. On web, Lynx runs JavaScript in a browser realm
    // (first the background thread's Web Worker, now the main thread's iframe),
    // which *does* have PerformanceObserver, so it proceeded to getDocument()
    // and crashed. Disabling both warnings makes
    // start() early-return before that call on every platform — and it's
    // semantically correct anyway: Lynx renders native <image>, not HTML <img>,
    // so these DOM-scanning diagnostics can never apply.
    {
      provide: IMAGE_CONFIG,
      useValue: {
        disableImageSizeWarning: true,
        disableImageLazyLoadWarning: true,
      },
    },
    LynxRendererFactory2,
    {
      provide: RendererFactory2,
      useExisting: LynxRendererFactory2,
    },
    {
      provide: ErrorHandler,
      useClass: LynxErrorHandler,
    },
  ]);
};
