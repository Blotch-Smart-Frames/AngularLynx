import { Component, computed, inject, input, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { UiDockScroll, UiDockState } from '../components/ui/dock';
import { injectGlassDesign } from '../components/ui/glass';
import { UiSearchField } from '../components/ui/search-field';
import { SEARCH_TAB } from './app';
import { ALBUMS, type Album, Catalog, SUGGESTIONS } from './catalog';

/**
 * A routed component's host is a real element in the app's column, and
 * arrives unstyled. `flex-1` gives it the column's height, so the scroll-view
 * inside has a height to scroll within instead of growing to fit its content.
 */
const SCREEN_HOST = { class: 'flex-1 flex-col flex' };

/**
 * Each screen's frame: a title clear of the status bar over content that
 * scrolls beneath the dock, which `ui-dock-scroll` minimizes on the way down.
 */
@Component({
  selector: 'app-screen',
  imports: [LYNX_ELEMENTS, UiDockScroll],
  host: SCREEN_HOST,
  template: `
    <scroll-view
      ui-dock-scroll
      scroll-orientation="vertical"
      class="h-full w-full"
    >
      <view class="flex-col gap-4 px-5 flex pt-safe-6 pb-safe-40">
        <text class="text-3xl font-bold text-foreground">{{ heading() }}</text>
        <ng-content />
      </view>
    </scroll-view>
  `,
})
export class Screen {
  readonly heading = input.required<string>();
}

/**
 * One album in a list.
 */
@Component({
  selector: 'app-album-row',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="flex-row items-center gap-3 flex">
      <view
        class="h-14 w-14 rounded-lg"
        [style.background-image]="album().cover"
      ></view>
      <view class="flex-1 flex-col flex">
        <text class="text-base font-medium text-foreground">{{
          album().title
        }}</text>
        <text class="text-sm text-muted-foreground">{{ album().artist }}</text>
      </view>
    </view>
  `,
})
export class AlbumRow {
  readonly album = input.required<Album>();
}

@Component({
  selector: 'app-home-screen',
  imports: [LYNX_ELEMENTS, Screen, UiSearchField],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Home">
      <text class="text-sm text-muted-foreground">
        A search field of its own, here at the top, and one in the dock: tap
        Search below, and the dock's search button grows into the field.
      </text>
      <text class="text-xs text-muted-foreground">{{ status() }}</text>

      <ui-search-field
        placeholder="Search your library"
        cancelable
        [value]="filter()"
        (valueChange)="filter.set($event)"
        (submitted)="submitted.set($event)"
      />
      <text class="text-xs text-muted-foreground">{{ filterStatus() }}</text>
      <text class="text-sm font-semibold text-foreground">
        The dock's search button
      </text>
      <view class="flex-row gap-2 flex">
        @for (option of options; track option.tab) {
          <view
            [class]="optionClass(option.tab)"
            [accessibility-element]="true"
            [accessibility-traits]="
              searchTab() === option.tab ? 'button,selected' : 'button'
            "
            [accessibility-label]="option.label"
            (bindtap)="searchTab.set(option.tab)"
          >
            <text [class]="optionTextClass(option.tab)">{{
              option.label
            }}</text>
          </view>
        }
      </view>
      <text class="text-xs text-muted-foreground">{{ searchStatus() }}</text>
    </app-screen>
  `,
})
export class HomeScreen {
  protected readonly searchTab = SEARCH_TAB;
  protected readonly options = [
    { tab: true, label: 'A search tab' },
    { tab: false, label: 'Opens the field here' },
  ];
  protected readonly filter = signal('');
  protected readonly submitted = signal('');

  readonly #catalog = inject(Catalog);
  readonly #design = injectGlassDesign();
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);
  readonly #dock = inject(UiDockState);

  protected readonly status = computed(() => {
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    return [
      `Design: ${this.#design()} on ${os}`,
      `Reduce Motion: ${this.#settings.reduceMotion() ? 'on' : 'off'}`,
    ].join(' · ');
  });

  protected readonly filterStatus = computed(() =>
    this.submitted()
      ? `Searched for "${this.submitted()}"`
      : `Typed: "${this.filter()}"`,
  );

  protected readonly searchStatus = computed(() => {
    const searched = this.#catalog.submitted();
    return [
      this.#dock.searching() ? 'The dock is searching' : 'The dock is closed',
      searched ? `last search: "${searched}"` : 'no search yet',
    ].join(' · ');
  });

  protected optionClass(tab: boolean): string {
    return this.searchTab() === tab
      ? 'rounded-full bg-primary px-4 py-2'
      : 'rounded-full bg-secondary px-4 py-2';
  }

  protected optionTextClass(tab: boolean): string {
    return this.searchTab() === tab
      ? 'text-sm font-medium text-primary-foreground'
      : 'text-sm font-medium text-secondary-foreground';
  }
}

@Component({
  selector: 'app-library-screen',
  imports: [LYNX_ELEMENTS, Screen, AlbumRow],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Library">
      @for (album of albums; track album.id) {
        <app-album-row [album]="album" />
      }
      @for (album of albums; track album.id) {
        <app-album-row [album]="album" />
      }
    </app-screen>
  `,
})
export class LibraryScreen {
  protected readonly albums = ALBUMS;
}

@Component({
  selector: 'app-search-screen',
  imports: [LYNX_ELEMENTS, Screen, AlbumRow],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Search">
      @if (catalog.query()) {
        @for (album of catalog.results(); track album.id) {
          <app-album-row [album]="album" />
        } @empty {
          <text class="text-sm text-muted-foreground">
            No albums match "{{ catalog.query() }}".
          </text>
        }
      } @else {
        <text class="text-sm text-muted-foreground">
          Type in the field at the bottom, or try one of these.
        </text>
        <view class="flex-row flex-wrap gap-2 flex">
          @for (suggestion of suggestions; track suggestion) {
            <view
              class="rounded-full bg-secondary px-4 py-2"
              [accessibility-element]="true"
              accessibility-traits="button"
              [accessibility-label]="suggestion"
              (bindtap)="catalog.query.set(suggestion)"
            >
              <text class="text-sm text-secondary-foreground">{{
                suggestion
              }}</text>
            </view>
          }
        </view>
      }
    </app-screen>
  `,
})
export class SearchScreen {
  protected readonly catalog = inject(Catalog);
  protected readonly suggestions = SUGGESTIONS;
}
