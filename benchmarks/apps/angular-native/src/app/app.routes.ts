import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { FavouritesPage } from './pages/favourites.ts';
import { Mount } from './pages/mount.ts';
import { Pokedex } from './pages/pokedex.ts';
import { PokemonSheet } from './pages/pokemon-sheet.ts';
import { Tabs } from './pages/tabs.ts';

/**
 * A screen of bench/ to launch straight into, such as `mount?kind=view&count=1500`, fixed when
 * Metro bundles. Instruments launches an app with no URL, so the benchmark's mount runs are a
 * build of their own rather than a deep link. Unset, the app starts on the tabs as the reference
 * does.
 */
const BENCH_SCREEN = process.env.EXPO_PUBLIC_BENCH_SCREEN;

export const routes: Routes = [
  BENCH_SCREEN
    ? {
        // The first navigation is redirected before any route is activated, so the tabs, the
        // list and its requests never exist in this build's launch.
        path: '',
        pathMatch: 'full',
        redirectTo: () => inject(Router).parseUrl(`/bench/${BENCH_SCREEN.replace(/^\/+/, '')}`),
      }
    : {
        path: '',
        component: Tabs,
        children: [
          { path: '', component: Pokedex },
          { path: 'favourites', component: FavouritesPage },
        ],
      },
  { path: 'pokemon/:id', component: PokemonSheet },
  { path: 'bench/mount', component: Mount },
];
