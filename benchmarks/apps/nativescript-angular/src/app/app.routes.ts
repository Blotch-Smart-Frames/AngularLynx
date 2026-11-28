import type { Routes } from '@angular/router';
import { Mount } from './pages/mount';
import { Tabs } from './pages/tabs';

/**
 * A screen of bench/ to launch straight into, such as `mount?kind=view&count=1500`, fixed when
 * webpack bundles (BENCH_SCREEN). Instruments launches an app with no URL, so the benchmark's mount
 * runs are a build of their own. Unset, the app starts on the tabs as the reference does.
 */
const BENCH_SCREEN = __BENCH_SCREEN__.replace(/^\/+/, '');

export const routes: Routes = [
  BENCH_SCREEN
    ? // The first navigation is redirected before any route is activated, so the tabs, the list
      // and its requests never exist in this build's launch.
      { path: '', pathMatch: 'full', redirectTo: `/bench/${BENCH_SCREEN}` }
    : { path: '', component: Tabs },
  { path: 'bench/mount', component: Mount },
];
