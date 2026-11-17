import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { withComponentInputBinding } from '@angular/router';
import {
  provideRenderer,
  provideRouter,
  provideSplashScreen,
} from '@blotch/angular-lynx';
import { routes } from './app.routes';
import { webCacheKey } from './data/web-cache-key';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    // AngularLynx's provideRouter: Angular's router on an in-memory history,
    // which Back, Android's back button and a swipe all go back through. A
    // work's screen reads its id as an input.
    provideRouter(routes, withComponentInputBinding()),
    // Angular's HttpClient, as on the web: the museum's API answers any
    // origin, so the same requests run in the apps and the web preview.
    provideHttpClient(withInterceptors([webCacheKey])),
    // The launch screen (angular.json's splash) stays up until the On View
    // wall has its first works, or knows it can't get them (OnViewWall
    // hides it), rather than giving way to an empty wall.
    provideSplashScreen({ hide: 'manual' }),
  ],
};
