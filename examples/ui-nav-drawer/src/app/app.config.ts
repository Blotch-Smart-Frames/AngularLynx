import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import {
  heartIcon,
  searchIcon,
  settingsIcon,
  starIcon,
  xIcon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({ heartIcon, searchIcon, settingsIcon, starIcon, xIcon }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
