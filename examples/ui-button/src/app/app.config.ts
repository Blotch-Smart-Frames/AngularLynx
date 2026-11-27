import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import {
  arrowRightIcon,
  checkIcon,
  downloadIcon,
  ellipsisIcon,
  fastForwardIcon,
  heartIcon,
  playIcon,
  plusIcon,
  rewindIcon,
  searchIcon,
  share2Icon,
  xIcon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({
      arrowRightIcon,
      checkIcon,
      downloadIcon,
      ellipsisIcon,
      fastForwardIcon,
      heartIcon,
      playIcon,
      plusIcon,
      rewindIcon,
      searchIcon,
      share2Icon,
      xIcon,
    }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
