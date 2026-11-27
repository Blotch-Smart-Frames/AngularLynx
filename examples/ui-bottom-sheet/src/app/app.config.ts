import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import { checkIcon, provideIcons } from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({ checkIcon }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
