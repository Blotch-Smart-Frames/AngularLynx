import type { Routes } from '@angular/router';

/**
 * Every screen is lazy: the atlas, with three.js behind it, is the only one
 * most visitors open, so the market's charts and the collection's list stay
 * out of the first bundle.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'atlas' },
  {
    path: 'atlas',
    loadComponent: () => import('./atlas/atlas').then((m) => m.AtlasPage),
  },
  {
    path: 'market',
    loadComponent: () => import('./market/market').then((m) => m.MarketPage),
  },
  {
    path: 'collection',
    loadComponent: () =>
      import('./collection/collection').then((m) => m.CollectionPage),
  },
];
