import { provideZonelessChangeDetection } from '@angular/core';
import { withInterceptorsFromDi } from '@angular/common/http';
import {
  ModalDialogService,
  bootstrapApplication,
  provideNativeScriptHttpClient,
  provideNativeScriptRouter,
  runNativeScriptAngularApp,
} from '@nativescript/angular';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { App } from './app/app';
import { routes } from './app/app.routes';

runNativeScriptAngularApp({
  appModuleBootstrap: () =>
    bootstrapApplication(App, {
      providers: [
        // The template's providers: HttpClient on NativeScript's Http module, the router on
        // native pages, and zoneless change detection.
        provideNativeScriptHttpClient(withInterceptorsFromDi()),
        provideNativeScriptRouter(routes),
        provideZonelessChangeDetection(),
        // NativeScriptCommonModule provides the modal service to the components that import it,
        // but the detail sheet's opener is a root service, so the root injector needs it too.
        ModalDialogService,
        // The reference's React Query client, on TanStack Query's Angular adapter (as the Angular
        // Native port): a cached answer is fresh for five minutes, a failed request is tried twice
        // more, and nothing refetches on focus.
        provideTanStackQuery(
          new QueryClient({
            defaultOptions: {
              queries: { staleTime: 1000 * 60 * 5, retry: 2, refetchOnWindowFocus: false },
            },
          }),
        ),
      ],
    }),
});
