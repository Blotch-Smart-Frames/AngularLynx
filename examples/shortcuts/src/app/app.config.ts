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
    // provideRouter from @blotch/angular-lynx, not @angular/router: it also
    // navigates to a shortcut's `route` when the person runs the shortcut.
    provideRouter(routes),
  ],
};
