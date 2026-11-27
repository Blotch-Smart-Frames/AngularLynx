import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import {
  cloudRainIcon,
  cloudSnowIcon,
  flameIcon,
  sunIcon,
  windIcon,
  zapIcon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({
      cloudRainIcon,
      cloudSnowIcon,
      flameIcon,
      sunIcon,
      windIcon,
      zapIcon,
    }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
