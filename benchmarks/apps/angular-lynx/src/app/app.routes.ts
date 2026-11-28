import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';

/**
 * The tabs, the detail sheet over them, and the benchmark's screens (mount,
 * tap, update and busy). Every screen is loaded lazily.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    // A benchmark build opens on its screen instead (BENCH_SCREEN, see
    // lynx.config.mts): the redirect happens before anything is loaded, so
    // the tabs aren't built and the list fetches nothing.
    redirectTo: () =>
      BENCH_SCREEN ? inject(Router).parseUrl(`/bench/${BENCH_SCREEN}`) : 'pokedex',
  },
  {
    path: 'bench/mount',
    loadComponent: () => import('./screens/mount').then((m) => m.Mount),
  },
  {
    path: 'bench/tap',
    loadComponent: () => import('./screens/tap').then((m) => m.Tap),
  },
  {
    path: 'bench/update',
    loadComponent: () => import('./screens/update').then((m) => m.Update),
  },
  {
    path: 'bench/busy',
    loadComponent: () => import('./screens/busy').then((m) => m.Busy),
  },
  {
    // Shown over whatever the primary outlet shows, as the original's form
    // sheet is over the tabs: `/pokedex(sheet:pokemon/25)`.
    path: 'pokemon/:id',
    outlet: 'sheet',
    loadComponent: () => import('./screens/pokemon-sheet').then((m) => m.PokemonSheet),
  },
  {
    // The tabs: each route under it is one, which <lynx-tab-outlet> keeps.
    path: '',
    loadComponent: () => import('./screens/tabs').then((m) => m.Tabs),
    children: [
      {
        path: 'pokedex',
        loadComponent: () => import('./screens/pokedex').then((m) => m.Pokedex),
      },
      {
        path: 'favourites',
        loadComponent: () => import('./screens/favourites').then((m) => m.FavouritesScreen),
      },
    ],
  },
];
