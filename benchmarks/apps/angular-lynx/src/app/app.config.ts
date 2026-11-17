import { provideHttpClient } from '@angular/common/http';
import { type ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { withComponentInputBinding } from '@angular/router';
import { provideColorScheme, provideRenderer, provideRouter } from '@blotch/angular-lynx';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    // Route params and the query bind to the screens' inputs.
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
    // The original draws in its own fixed light colors whatever the phone's
    // appearance, so the @blotch/ui components stay in their light colors.
    provideColorScheme('light'),
  ],
};
