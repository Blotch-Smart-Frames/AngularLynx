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
    path: 'inbox',
    loadComponent: () => import('./screens').then((m) => m.InboxScreen),
  },
  {
    path: 'inbox/:id',
    loadComponent: () => import('./screens').then((m) => m.MessageScreen),
  },
  {
    path: 'profile',
    loadComponent: () => import('./screens').then((m) => m.ProfileScreen),
  },
];
