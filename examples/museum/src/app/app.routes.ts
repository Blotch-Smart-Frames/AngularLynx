import type { Routes } from '@angular/router';

/**
 * Three tabs, each loaded the first time it's shown (or built ahead, see
 * App's `prebuild`), each with a stack of its own: a tab's first screen,
 * a work pushed over it, and the work's picture pushed over that to zoom.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'on-view' },
  { path: 'on-view', loadChildren: () => import('./on-view/routes') },
  { path: 'search', loadChildren: () => import('./search/routes') },
  { path: 'saved', loadChildren: () => import('./saved/routes') },
];
