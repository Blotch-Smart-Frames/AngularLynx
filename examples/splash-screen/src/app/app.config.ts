import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideRenderer,
  provideRouter,
  provideSplashScreen,
} from '@blotch/angular-lynx';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    provideRouter(routes),
    // Keeps the launch screen (angular.json's splash) up until the first
    // navigation ends, with the tides its resolver loads, and the screen is
    // drawn. Without it, the splash screen goes at Angular's first frame,
    // and the app shows an empty screen while the tides load.
    provideSplashScreen({ hide: 'afterFirstNavigation' }),
  ],
};
