import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';

export const settingsConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection(), provideRenderer()],
};
