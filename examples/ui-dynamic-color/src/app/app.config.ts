import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import { calendarIcon, share2Icon, provideIcons } from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({ calendarIcon, share2Icon }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
