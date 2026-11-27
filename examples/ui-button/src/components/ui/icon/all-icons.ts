import { type Provider } from '@angular/core';

import * as iconSet from './icon-set';
import { provideIcons } from './icons';

/**
 * Registers every icon in the set, as an app drew them before
 * `provideIcons()`: for an app that draws icons by names it can't list, such
 * as names from a server. It puts the whole set in the app's main-thread
 * script, about 34 kB, so prefer listing the icons with `provideIcons()`.
 *
 * In a file of its own, so icons.ts, which every component that draws an
 * icon imports, refers to the set by its type alone.
 */
export const provideAllIcons = (): Provider => provideIcons(iconSet);
