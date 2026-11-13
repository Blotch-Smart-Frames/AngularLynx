import type { Routes } from '@angular/router';
import { Postcards } from './postcards';

export const routes: Routes = [
  { path: '', component: Postcards },
  {
    // Where the "Show stamps" shortcut leads: angular.json gives it this
    // path as its `route`.
    path: 'stamps',
    loadComponent: () => import('./stamps').then((m) => m.Stamps),
  },
];
