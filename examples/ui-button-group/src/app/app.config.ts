import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import {
  heartIcon,
  minusIcon,
  plusIcon,
  redo2Icon,
  share2Icon,
  trash2Icon,
  undo2Icon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({
      heartIcon,
      minusIcon,
      plusIcon,
      redo2Icon,
      share2Icon,
      trash2Icon,
      undo2Icon,
    }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
