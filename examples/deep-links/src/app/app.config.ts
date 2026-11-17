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
    // provideRouter from @blotch/angular-lynx, not @angular/router: it also
    // sends a link with the app's scheme (angular.json's deepLinkSchemes) to
    // its route, the link that starts the app and those that come while it's
    // open. withComponentInputBinding() hands the event screen the link's
    // :id and ?seat as inputs.
    provideRouter(routes, withComponentInputBinding()),
  ],
};
