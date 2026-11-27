import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import {
  bellIcon,
  heartIcon,
  infoIcon,
  minusIcon,
  plusIcon,
  userPlusIcon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({
      bellIcon,
      heartIcon,
      infoIcon,
      minusIcon,
      plusIcon,
      userPlusIcon,
    }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
