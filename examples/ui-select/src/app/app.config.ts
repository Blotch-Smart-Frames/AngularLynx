import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import {
  cloudIcon,
  cloudRainIcon,
  cloudSnowIcon,
  sunIcon,
  windIcon,
  zapIcon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({
      cloudIcon,
      cloudRainIcon,
      cloudSnowIcon,
      sunIcon,
      windIcon,
      zapIcon,
    }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
