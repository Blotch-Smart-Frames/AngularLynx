import type { Routes } from '@angular/router';
import { Events } from './events';

export const routes: Routes = [
  { path: '', component: Events },
  {
    // Where tickets://events/<id> leads: for the app's own scheme, the part
    // after // is the route.
    path: 'events/:id',
    loadComponent: () => import('./event-detail').then((m) => m.EventDetail),
  },
];
