import { Component, computed, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiDock, UiDockAction, UiDockItem } from '../components/ui/dock';
import { UiSearchField } from '../components/ui/search-field';
import { UiToaster } from '../components/ui/toast';
import { AtlasState } from './state/atlas-state';

/**
 * The shell: the screens fill it, the glass dock floats over them, and the
 * chosen stone's color is set here as the theme's primary, so every screen,
 * chart and piece of glass below takes it.
 */
@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    RouterOutlet,
    UiDock,
    UiDockAction,
    UiDockItem,
    UiSearchField,
    UiToaster,
  ],
  template: `
    <view
      class="flex h-full w-full flex-col bg-background"
      [class.dark]="atlas.dark()"
      [style.--stone]="atlas.color()"
      [style.--stone-rgb]="atlas.rgb()"
      [style.--primary]="atlas.color()"
      [style.--primary-rgb]="atlas.rgb()"
      [style.--ring]="atlas.color()"
      [style.--glass-tint]="atlas.color()"
      [style.--glass-tint-rgb]="atlas.rgb()"
    >
      <router-outlet />

      <ui-dock>
        <ui-dock-item route="/atlas" icon="sparkles" label="Atlas" />
        <ui-dock-item route="/market" icon="chart-line" label="Market" />
        <ui-dock-item
          route="/collection"
          icon="layout-grid"
          label="Collection"
          [badge]="keptCount()"
        />
        <!-- The search action opens the field at the bottom of the screen;
             what's typed filters the collection's lots. -->
        <ui-dock-action icon="search" label="Search lots" />
        <ui-search-field
          [(value)]="atlas.query"
          placeholder="Search lots"
          (submitted)="showCollection()"
        />
      </ui-dock>

      <ui-toaster />
    </view>
  `,
})
export class App {
  protected readonly atlas = inject(AtlasState);
  readonly #router = inject(Router);

  protected readonly keptCount = computed(
    () => this.atlas.kept().length || null,
  );

  protected showCollection(): void {
    void this.#router.navigateByUrl('/collection');
  }
}
