import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    loadComponent: () => import('./screens').then((m) => m.HomeScreen),
  },
  {
    path: 'browse',
    loadComponent: () => import('./screens').then((m) => m.BrowseScreen),
  },
  {
    // A stack of its own: an album pushes over the list (see LibraryStack).
    path: 'library',
    loadComponent: () => import('./screens').then((m) => m.LibraryStack),
    children: [
      {
        path: '',
        loadComponent: () => import('./screens').then((m) => m.LibraryScreen),
      },
      {
        path: ':album',
        loadComponent: () => import('./screens').then((m) => m.AlbumScreen),
      },
    ],
  },
  {
    path: 'search',
    loadComponent: () => import('./screens').then((m) => m.SearchScreen),
  },
];
