import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { withComponentInputBinding } from '@angular/router';
import { provideRenderer, provideRouter } from '@blotch/angular-lynx';
import { routes } from './app.routes';
import {
  homeIcon,
  inboxIcon,
  searchIcon,
  userIcon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({ homeIcon, inboxIcon, searchIcon, userIcon }),
    provideZonelessChangeDetection(),
    provideRenderer(),
    // provideRouter from @blotch/angular-lynx, not @angular/router: it keeps
    // the URL in memory, and lets the active tab be marked selected for
    // screen readers. withComponentInputBinding() hands /inbox/:id's id to
    // the message screen as an input.
    provideRouter(routes, withComponentInputBinding()),
  ],
};
