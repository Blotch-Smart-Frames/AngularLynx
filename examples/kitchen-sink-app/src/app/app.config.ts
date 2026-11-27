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
import { provideAllIcons } from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    // The icon showcase draws every icon in the set. An app registers only
    // the ones it draws, with provideIcons({ heartIcon, ... }), so the rest
    // stay out of its scripts.
    provideAllIcons(),
    provideZonelessChangeDetection(),
    provideRenderer(),
    provideLocale(),
    provideRouter(routes),
  ],
};
