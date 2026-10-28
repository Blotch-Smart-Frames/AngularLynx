import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiDock, UiDockAction, UiDockItem } from '../components/ui/dock';
import { UiSearchField } from '../components/ui/search-field';
import { Catalog } from './catalog';

/**
 * Whether the dock's search button is a search tab, with a route of its own,
 * or an action that opens the field over the current screen. The Home
 * screen switches it.
 */
export const SEARCH_TAB = signal(true);

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    RouterOutlet,
    UiDock,
    UiDockAction,
    UiDockItem,
    UiSearchField,
  ],
  template: `
    <!-- The screens fill the whole screen, and the dock floats over them at
         the bottom: their content scrolls beneath it. -->
    <view class="h-full flex-col bg-background flex">
      <router-outlet />

      <ui-dock>
        <ui-dock-item route="/home" icon="home" label="Home" />
        <ui-dock-item route="/library" icon="music" label="Library" />

        <!-- With a route, it's the search tab: the field opens while the
             search screen shows. Without one, it opens the field over the
             screen you're on. -->
        <ui-dock-action
          [route]="searchTab() ? '/search' : null"
          icon="search"
          label="Search"
        />
        <ui-search-field
          placeholder="Albums and artists"
          cancelable
          [value]="catalog.query()"
          (valueChange)="catalog.query.set($event)"
          (submitted)="catalog.submitted.set($event)"
        />
      </ui-dock>
    </view>
  `,
})
export class App {
  protected readonly catalog = inject(Catalog);
  protected readonly searchTab = SEARCH_TAB;
}
