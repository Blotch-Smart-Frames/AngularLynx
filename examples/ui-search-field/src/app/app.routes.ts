import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    loadComponent: () => import('./screens').then((m) => m.HomeScreen),
  },
  {
    path: 'library',
    loadComponent: () => import('./screens').then((m) => m.LibraryScreen),
  },
  {
    path: 'search',
    loadComponent: () => import('./screens').then((m) => m.SearchScreen),
  },
];
