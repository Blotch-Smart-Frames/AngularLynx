import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { withComponentInputBinding } from '@angular/router';
import {
  provideColorScheme,
  provideRenderer,
  provideRouter,
} from '@blotch/angular-lynx';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    // Airmail is light, as paper is, whatever the phone's setting: its palette
    // (styles.css) has no night. Left to follow the phone, the page would
    // take the theme's dark class, and the theme's dark background, text and
    // icon colors would land on the paper.
    provideColorScheme('light'),
    // AngularLynx's provideRouter: Angular's router on an in-memory history,
    // which Back, the Android back button and a swipe all go back through.
    // The thread reads its correspondent's id as an input.
    provideRouter(routes, withComponentInputBinding()),
  ],
};
