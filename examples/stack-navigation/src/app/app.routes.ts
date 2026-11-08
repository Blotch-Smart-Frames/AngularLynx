import type { Routes } from '@angular/router';
import { ItemScreen, SectionScreen, SettingsScreen } from './screens';

/**
 * Three levels, as the Settings app has: each level's URL is under the one
 * before it, so going to one pushes it, and going back to one in the stack
 * pops back to it.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'settings' },
  { path: 'settings', component: SettingsScreen },
  { path: 'settings/:section', component: SectionScreen },
  { path: 'settings/:section/:item', component: ItemScreen },
];
