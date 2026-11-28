import { provideHttpClient } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {
  providers: [
    // The template's providers, without its preloading: every screen is in the main bundle, as
    // in the other ports.
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // The detail sheet takes its Pokémon as a signal input, which ModalController's
    // componentProps would overwrite with a plain value unless it sets them with setInput().
    provideIonicAngular({ useSetInputAPI: true }),
    provideRouter(routes, withComponentInputBinding()),
    // HttpClient on the web view's XMLHttpRequest.
    provideHttpClient(),
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
});
