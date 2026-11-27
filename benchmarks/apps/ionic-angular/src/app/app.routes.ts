import type { Routes } from '@angular/router';
import { BENCH_SCREEN } from './data/config';
import { FavouritesPage } from './pages/favourites';
import { Mount } from './pages/mount';
import { Pokedex } from './pages/pokedex';
import { Tabs } from './pages/tabs';

/**
 * The template's tabs, holding the reference's two. Every screen is imported here rather than
 * loaded lazily, so the launch fetches no extra script, as in the other ports.
 */
export const routes: Routes = [
  BENCH_SCREEN
    ? // The first navigation is redirected before any route is activated, so the tabs, the list
      // and its requests never exist in this build's launch.
      { path: '', pathMatch: 'full', redirectTo: `/bench/${BENCH_SCREEN}` }
    : { path: '', pathMatch: 'full', redirectTo: '/tabs/pokedex' },
  {
    path: 'tabs',
    component: Tabs,
    children: [
      { path: 'pokedex', component: Pokedex },
      { path: 'favourites', component: FavouritesPage },
    ],
  },
  { path: 'bench/mount', component: Mount },
];
