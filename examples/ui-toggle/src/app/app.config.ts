import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import {
  boldIcon,
  codeIcon,
  listIcon,
  quoteIcon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({ boldIcon, codeIcon, listIcon, quoteIcon }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
