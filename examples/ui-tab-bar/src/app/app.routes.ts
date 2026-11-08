import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    loadComponent: () => import('./screens').then((m) => m.HomeScreen),
  },
  {
    path: 'search',
    loadComponent: () => import('./screens').then((m) => m.SearchScreen),
  },
  {
    // A stack of its own: a message pushes over the list (see InboxStack).
    path: 'inbox',
    loadComponent: () => import('./screens').then((m) => m.InboxStack),
    children: [
      {
        path: '',
        loadComponent: () => import('./screens').then((m) => m.InboxScreen),
      },
      {
        path: ':id',
        loadComponent: () => import('./screens').then((m) => m.MessageScreen),
      },
    ],
  },
  {
    path: 'profile',
    loadComponent: () => import('./screens').then((m) => m.ProfileScreen),
  },
];
