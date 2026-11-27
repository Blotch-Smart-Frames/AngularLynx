import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import {
  circleIcon,
  heartIcon,
  homeIcon,
  inboxIcon,
  moonIcon,
  pauseIcon,
  playIcon,
  plusIcon,
  searchIcon,
  sunIcon,
  userIcon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({
      circleIcon,
      heartIcon,
      homeIcon,
      inboxIcon,
      moonIcon,
      pauseIcon,
      playIcon,
      plusIcon,
      searchIcon,
      sunIcon,
      userIcon,
    }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
