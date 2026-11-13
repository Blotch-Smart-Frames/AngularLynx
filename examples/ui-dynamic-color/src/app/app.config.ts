import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';

export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection(), provideRenderer()],
};
