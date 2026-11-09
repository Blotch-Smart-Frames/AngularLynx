import type { Routes } from '@angular/router';

/**
 * The inbox, and a conversation pushed over it. The thread is a lazy route:
 * its code loads the first time a letter is opened.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'letters' },
  {
    path: 'letters',
    loadComponent: () => import('./inbox/inbox').then((m) => m.Inbox),
  },
  {
    path: 'letters/:id',
    loadComponent: () => import('./thread/thread').then((m) => m.Thread),
  },
];
