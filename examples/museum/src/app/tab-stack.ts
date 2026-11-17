import { Component } from '@angular/core';
import type { Route, Routes } from '@angular/router';
import { LYNX_ELEMENTS, LynxStackOutlet } from '@blotch/angular-lynx';

/**
 * A tab's stack: its first screen, with the screens pushed over it sliding
 * in and swiping back as a native app's do. The tab outlet keeps the whole
 * stack while another tab shows, so coming back finds the work that was
 * open, scrolled where it was left.
 */
@Component({
  selector: 'app-tab-stack',
  imports: [LYNX_ELEMENTS, LynxStackOutlet],
  host: { class: 'flex flex-1 flex-col bg-bar' },
  template: `<lynx-stack-outlet pageClass="bg-bar" />`,
})
export class TabStack {}

/**
 * A tab's routes: its first screen, then a work (`work/123`) and its zoom
 * (`work/123/zoom`), each a level deeper, so each pushes.
 */
export const tabRoutes = (first: Route): Routes => [
  {
    path: '',
    component: TabStack,
    children: [
      { path: '', ...first },
      {
        path: 'work/:id',
        loadComponent: () =>
          import('./artwork/artwork').then((m) => m.ArtworkScreen),
      },
      {
        path: 'work/:id/zoom',
        loadComponent: () => import('./artwork/viewer').then((m) => m.Viewer),
      },
    ],
  },
];
