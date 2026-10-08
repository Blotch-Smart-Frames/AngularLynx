import {
  type ApplicationConfig,
  ErrorHandler,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer } from '@blotch/angular-lynx';
import { BoundaryReportingErrorHandler } from './boundary-log';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    // Must come after provideRenderer(), which registers LynxErrorHandler.
    { provide: ErrorHandler, useClass: BoundaryReportingErrorHandler },
  ],
};
