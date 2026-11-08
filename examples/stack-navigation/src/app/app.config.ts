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
    // From @blotch/angular-lynx: the history lives in memory, which Back, the
    // Android back button and a swipe all go back through.
    provideRouter(routes, withComponentInputBinding()),
  ],
};
