import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { withComponentInputBinding } from '@angular/router';
import { provideRenderer, provideRouter } from '@blotch/angular-lynx';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    // AngularLynx's provideRouter: Angular's router on an in-memory history,
    // which Back, the Android back button and a swipe all go back through.
    // The thread reads its correspondent's id as an input.
    provideRouter(routes, withComponentInputBinding()),
  ],
};
