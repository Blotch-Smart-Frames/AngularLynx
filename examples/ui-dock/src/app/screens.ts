import { Component, computed, inject, input } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { UiDockScroll } from '../components/ui/dock';
import { injectGlassDesign } from '../components/ui/glass';
import { ALBUMS, Player } from './player';

/**
 * A routed component's host is a real element in the app's column, and
 * arrives unstyled. `flex-1` gives it the column's height, so the scroll-view
 * inside has a height to scroll within instead of growing to fit its content.
 */
const SCREEN_HOST = { class: 'flex-1 flex-col flex' };

/**
 * Each screen's frame: a title clear of the status bar over content that
 * scrolls beneath the dock. `ui-dock-scroll` minimizes the dock as it scrolls
 * down, and the bottom padding lets the last row scroll clear of it.
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
 * A grid of album covers, for the dock to float over.
 */
@Component({
  selector: 'app-album-grid',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="flex-row flex-wrap gap-4 flex">
      @for (album of albums; track album.id) {
        <view
          class="w-[47%] flex-col gap-1.5 flex"
          [accessibility-element]="true"
          accessibility-traits="button"
          [accessibility-label]="album.title + ', ' + album.artist"
          (bindtap)="player.play(album)"
        >
          <view
            class="h-[160px] rounded-xl"
            [style.background-image]="album.cover"
          ></view>
          <text class="text-sm font-medium text-foreground">{{
            album.title
          }}</text>
          <text class="text-xs text-muted-foreground">{{ album.artist }}</text>
        </view>
      }
    </view>
  `,
})
export class AlbumGrid {
  protected readonly albums = ALBUMS;
  protected readonly player = inject(Player);
}

@Component({
  selector: 'app-home-screen',
  imports: [LYNX_ELEMENTS, Screen, AlbumGrid],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Home">
      <text class="text-sm text-muted-foreground">
        Scroll down and the dock minimizes; scroll up and it comes back. Tap an
        album to play it in the accessory above the dock.
      </text>
      <text class="text-xs text-muted-foreground">{{ status() }}</text>
      <view class="flex-row gap-2 flex">
        <view
          class="rounded-full bg-secondary px-4 py-2"
          [accessibility-element]="true"
          accessibility-traits="button"
          (bindtap)="player.album() ? player.stop() : player.play(albums[1])"
        >
          <text class="text-sm font-medium text-secondary-foreground">{{
            player.album() ? 'Hide accessory' : 'Show accessory'
          }}</text>
        </view>
      </view>
      <app-album-grid />
    </app-screen>
  `,
})
export class HomeScreen {
  protected readonly player = inject(Player);
  protected readonly albums = ALBUMS;

  readonly #design = injectGlassDesign();
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);

  protected readonly status = computed(() => {
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    return [
      `Design: ${this.#design()} on ${os}`,
      `Reduce Motion: ${this.#settings.reduceMotion() ? 'on' : 'off'}`,
    ].join(' · ');
  });
}

@Component({
  selector: 'app-browse-screen',
  imports: [LYNX_ELEMENTS, Screen],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Browse">
      @for (genre of genres; track genre.name) {
        <view
          class="h-24 rounded-2xl p-4 flex justify-end"
          [style.background-image]="genre.color"
        >
          <text class="text-lg font-bold text-white">{{ genre.name }}</text>
        </view>
      }
    </app-screen>
  `,
})
export class BrowseScreen {
  protected readonly genres = [
    { name: 'Pop', color: 'linear-gradient(120deg, #f472b6, #8b5cf6)' },
    { name: 'Rock', color: 'linear-gradient(120deg, #f97316, #b91c1c)' },
    { name: 'Jazz', color: 'linear-gradient(120deg, #0ea5e9, #1e3a8a)' },
    { name: 'Electronic', color: 'linear-gradient(120deg, #22d3ee, #6d28d9)' },
    { name: 'Classical', color: 'linear-gradient(120deg, #a3a3a3, #44403c)' },
    { name: 'Hip-Hop', color: 'linear-gradient(120deg, #facc15, #ea580c)' },
    { name: 'Folk', color: 'linear-gradient(120deg, #84cc16, #15803d)' },
    { name: 'Soul', color: 'linear-gradient(120deg, #fb7185, #9f1239)' },
  ];
}

@Component({
  selector: 'app-library-screen',
  imports: [LYNX_ELEMENTS, Screen],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Library">
      @for (album of albums; track album.id) {
        <view
          class="flex-row items-center gap-3 flex"
          [accessibility-element]="true"
          accessibility-traits="button"
          [accessibility-label]="album.title + ', ' + album.artist"
          (bindtap)="player.play(album)"
        >
          <view
            class="h-14 w-14 rounded-lg"
            [style.background-image]="album.cover"
          ></view>
          <view class="flex-1 flex-col flex">
            <text class="text-base font-medium text-foreground">{{
              album.title
            }}</text>
            <text class="text-sm text-muted-foreground">{{
              album.artist
            }}</text>
          </view>
        </view>
      }
    </app-screen>
  `,
})
export class LibraryScreen {
  protected readonly albums = ALBUMS;
  protected readonly player = inject(Player);
}

@Component({
  selector: 'app-search-screen',
  imports: [LYNX_ELEMENTS, Screen, AlbumGrid],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Search">
      <text class="text-sm text-muted-foreground">
        The search button sits apart from the bar, in the same glass, and is
        selected while you're here.
      </text>
      <app-album-grid />
    </app-screen>
  `,
})
export class SearchScreen {}
