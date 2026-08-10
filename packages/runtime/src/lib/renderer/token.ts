import { InjectionToken } from '@angular/core';
import type { LynxDocumentBase } from '../lynx-document';

/**
 * Separate token file breaks the circular import that would result from placing
 * LYNX_DOCUMENT in providers.ts (which imports lynx-document.ts, which would
 * then import providers.ts to read the token).
 */
export const LYNX_DOCUMENT = new InjectionToken<LynxDocumentBase>(
  'lynx-document',
);
