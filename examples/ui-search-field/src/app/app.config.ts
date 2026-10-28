import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer, provideRouter } from '@blotch/angular-lynx';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    // provideRouter from @blotch/angular-lynx, not @angular/router: it keeps
    // the URL in memory, and lets the selected item be marked selected for
    // screen readers.
    provideRouter(routes),
  ],
};
