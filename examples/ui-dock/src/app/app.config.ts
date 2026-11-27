import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer, provideRouter } from '@blotch/angular-lynx';
import { routes } from './app.routes';
import {
  chevronLeftIcon,
  homeIcon,
  layoutGridIcon,
  musicIcon,
  pauseIcon,
  playIcon,
  searchIcon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({
      chevronLeftIcon,
      homeIcon,
      layoutGridIcon,
      musicIcon,
      pauseIcon,
      playIcon,
      searchIcon,
    }),
    provideZonelessChangeDetection(),
    provideRenderer(),
    // provideRouter from @blotch/angular-lynx, not @angular/router: it keeps
    // the URL in memory, and lets the selected item be marked selected for
    // screen readers.
    provideRouter(routes),
  ],
};
