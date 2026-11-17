import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxShortcuts,
  LynxTabOutlet,
} from '@blotch/angular-lynx';
import { OnViewWall } from './on-view/on-view-wall';
import { TabBar } from './wall/tab-bar';

/**
 * Vitrine: the Cleveland Museum of Art's open-access collection as a
 * glazed wall. Three tabs in a `<lynx-tab-outlet>`, which keeps each one,
 * stack and scroll and all, once it's been shown; the tab bar floats over
 * them.
 *
 * Search and Saved are built ahead (`prebuild`), once On View is drawn, one
 * per task between frames, so the first tap on either shows it at once.
 */
@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, LynxTabOutlet, TabBar],
  template: `
    <view class="relative flex h-full w-full flex-col bg-bar">
      <lynx-tab-outlet [prebuild]="['search', 'saved']" />
      <app-tab-bar />
    </view>
  `,
})
export class App {
  readonly #router = inject(Router);
  readonly #wall = inject(OnViewWall);

  constructor() {
    // "Show me a work" (Siri, or the app icon's menu) opens a work from the
    // wall at random. The other shortcuts open a tab by their `route` in
    // angular.json, with no code. Registered here, at the root, so it runs
    // wherever the person is when they ask.
    inject(LynxShortcuts).on('surprise', async () => {
      const work = await this.#wall.pick();
      await this.#router.navigateByUrl(`/on-view/work/${work.id}`);
    });
  }
}
