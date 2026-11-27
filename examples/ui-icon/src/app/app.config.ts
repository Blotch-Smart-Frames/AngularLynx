import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import { provideAllIcons } from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    // This example shows every icon in the set. An app registers only the
    // ones it draws, with provideIcons({ heartIcon, ... }), so the rest stay
    // out of its scripts.
    provideAllIcons(),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
