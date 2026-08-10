import { APP_BASE_HREF, IMAGE_CONFIG } from '@angular/common';
import {
  DOCUMENT,
  ErrorHandler,
  type EnvironmentProviders,
  makeEnvironmentProviders,
  RendererFactory2,
} from '@angular/core';
import { LynxErrorHandler } from '../error-handler/lynx-error-handler';
import { LynxBackgroundDocument, LynxDocument } from '../lynx-document';
import { LynxHydrateDocument } from '../ssr/hydrate-document';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { LYNX_DOCUMENT } from './token';

/**
 * Central DI configuration for the Lynx renderer. Must be included in every
 * Lynx Angular app's providers (typically via app.config.ts). Sets up:
 * 1. Thread-aware document (LynxDocument vs LynxBackgroundDocument)
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
        // Three paths based on thread + SSR state:
        // 1. Main thread + SSR hydrating → LynxHydrateDocument (reuse snapshot elements)
        // 2. Main thread + normal → LynxDocument (create native elements via PAPI)
        // 3. Background thread → LynxBackgroundDocument (virtual in-memory tree)
        if (__MAIN_THREAD__) {
          if (__ENABLE_SSR__ && (globalThis as any).__LYNX_IS_HYDRATING__) {
            return new LynxHydrateDocument(
              (globalThis as any).__LYNX_HYDRATE_PAGE__,
              (globalThis as any).__LYNX_HYDRATE_QUEUE__,
            );
          }
          return new LynxDocument();
        }
        return new LynxBackgroundDocument();
      },
    },
    {
      // Angular's internal code occasionally accesses @Inject(DOCUMENT). In Lynx
      // there is no DOM document, so we provide an empty object. Specific access
      // points (defaultView, querySelector) are polyfilled in runtime.ts.
      provide: DOCUMENT,
      useValue: {},
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
    // This only bit the *web* runtime: ImagePerformanceWarning.start() early-
    // returns when `PerformanceObserver` is undefined, which is the case in the
    // native (iOS/Android) background-thread JS engine. On web the background
    // thread is a real Web Worker, which *does* have PerformanceObserver, so it
    // proceeded to getDocument() and crashed. Disabling both warnings makes
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
