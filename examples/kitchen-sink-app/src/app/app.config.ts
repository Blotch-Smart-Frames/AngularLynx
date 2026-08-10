import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideLocale,
  provideRenderer,
  provideRouter,
} from '@blotch/angular-lynx';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    provideLocale(),
    provideRouter(routes),
  ],
};
