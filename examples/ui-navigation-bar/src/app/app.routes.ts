import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'notes' },
  {
    path: 'notes',
    loadComponent: () => import('./screens').then((m) => m.NotesScreen),
  },
  {
    path: 'notes/:id',
    loadComponent: () => import('./screens').then((m) => m.NoteScreen),
  },
];
