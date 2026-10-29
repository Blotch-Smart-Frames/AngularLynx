import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import { provideIconTheme } from '../components/ui/icon/icon-theme';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    // The app follows the phone's appearance (the dark class in app.ts), so
    // icons do too, and so does the scheme UiDynamicColor sets.
    provideIconTheme({ colorScheme: 'system' }),
  ],
};
