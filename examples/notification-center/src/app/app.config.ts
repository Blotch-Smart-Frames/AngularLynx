import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import { bellIcon, provideIcons } from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({ bellIcon }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
