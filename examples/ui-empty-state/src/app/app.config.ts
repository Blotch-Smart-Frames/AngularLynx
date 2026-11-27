import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import { plusIcon, searchIcon, provideIcons } from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({ plusIcon, searchIcon }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
