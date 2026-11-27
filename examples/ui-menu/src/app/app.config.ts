import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import {
  archiveIcon,
  arrowDownIcon,
  calendarIcon,
  clockIcon,
  copyIcon,
  ellipsisIcon,
  filterIcon,
  folderIcon,
  heartIcon,
  listChecksIcon,
  plusIcon,
  trashIcon,
  uploadIcon,
  provideIcons,
} from '../components/ui/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideIcons({
      archiveIcon,
      arrowDownIcon,
      calendarIcon,
      clockIcon,
      copyIcon,
      ellipsisIcon,
      filterIcon,
      folderIcon,
      heartIcon,
      listChecksIcon,
      plusIcon,
      trashIcon,
      uploadIcon,
    }),
    provideZonelessChangeDetection(),
    provideRenderer(),
  ],
};
