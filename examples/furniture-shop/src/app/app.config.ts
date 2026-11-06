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
    // AngularLynx's provideRouter: Angular's router on an in-memory location,
    // since Lynx has no History API. withComponentInputBinding() hands the
    // product route's `:index` to the page as an input.
    provideRouter(routes, withComponentInputBinding()),
  ],
};
