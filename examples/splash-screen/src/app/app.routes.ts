import type { Routes } from '@angular/router';
import { loadTides, Tides } from './tides';

export const routes: Routes = [
  {
    path: '',
    component: Tides,
    // The screen can't draw before its tides are in, so the splash screen
    // waits for this too.
    resolve: { tides: loadTides },
  },
];
