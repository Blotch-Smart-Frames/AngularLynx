import { Location } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxStackOutlet,
  LynxStackPage,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { UiDockScroll } from '../components/ui/dock';
import { injectGlassDesign } from '../components/ui/glass';
import { UiIcon } from '../components/ui/icon';
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
 *
 * A screen the Library's stack pushes has a Back button, and the dock goes
 * away while it's on top: `LynxStackPage.bottomBarHidden()` says so, and the
 * screen drops the padding it keeps for the dock.
 */
@Component({
  selector: 'app-screen',
  imports: [LYNX_ELEMENTS, UiDockScroll, UiIcon],
  host: SCREEN_HOST,
  template: `
    <scroll-view
      ui-dock-scroll
      scroll-orientation="vertical"
      class="h-full w-full"
    >
      <view [class]="contentClass()">
        @if (back(); as label) {
          <view
            class="flex-row items-center gap-1 flex"
            [accessibility-element]="true"
            accessibility-traits="button"
            [accessibility-label]="'Back to ' + label"
            (bindtap)="location.back()"
          >
            <ui-icon name="chevron-left" size="sm" />
            <text class="text-base text-primary">{{ label }}</text>
          </view>
        }
        <text class="text-3xl font-bold text-foreground">{{ heading() }}</text>
        <ng-content />
      </view>
    </scroll-view>
  `,
})
export class Screen {
  readonly heading = input.required<string>();
  /** The title of the screen Back goes to, on a screen a stack pushed. */
  readonly back = input<string>();

  protected readonly location = inject(Location);
  readonly #page = inject(LynxStackPage, { optional: true });

  protected readonly contentClass = computed(() =>
    this.#page?.bottomBarHidden()
      ? 'flex-col gap-4 px-5 flex pt-safe-6 pb-safe-6'
      : 'flex-col gap-4 px-5 flex pt-safe-6 pb-safe-40',
  );
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

/**
 * The Library tab: a stack of its own, in a `<lynx-stack-outlet>`. An album
 * opens over the list, as in a music app, and takes the dock away until you
 * go back with Back, Android's back button or a swipe, which brings the dock
 * back with the list.
 */
@Component({
  selector: 'app-library-stack',
  imports: [LYNX_ELEMENTS, LynxStackOutlet],
  host: SCREEN_HOST,
  template: `<lynx-stack-outlet />`,
})
export class LibraryStack {}

@Component({
  selector: 'app-library-screen',
  imports: [LYNX_ELEMENTS, RouterLink, Screen],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Library">
      <text class="text-sm text-muted-foreground">
        Open an album: it slides in over the list and takes the dock away. Back,
        or a swipe to the right, brings the dock back.
      </text>
      @for (album of albums; track album.id) {
        <view
          class="flex-row items-center gap-3 flex"
          [accessibility-element]="true"
          accessibility-traits="button"
          [accessibility-label]="album.title + ', ' + album.artist"
          [routerLink]="['/library', album.id]"
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
}

/**
 * An album, pushed over the Library: no dock here, so its last track scrolls
 * to the bottom of the screen.
 */
@Component({
  selector: 'app-album-screen',
  imports: [LYNX_ELEMENTS, RouterLink, Screen],
  host: SCREEN_HOST,
  template: `
    <app-screen [heading]="album().title" back="Library">
      <view
        class="h-[240px] rounded-2xl"
        [style.background-image]="album().cover"
      ></view>
      <view class="flex-row items-center flex justify-between">
        <text class="text-base text-muted-foreground">{{
          album().artist
        }}</text>
        <view
          class="rounded-full bg-primary px-5 py-2"
          [accessibility-element]="true"
          accessibility-traits="button"
          accessibility-label="Play"
          (bindtap)="player.play(album())"
        >
          <text class="text-sm font-semibold text-primary-foreground"
            >Play</text
          >
        </view>
      </view>
      @for (track of tracks; track track; let i = $index) {
        <view
          class="flex-row items-center gap-3 border-b border-border py-3 flex"
        >
          <text class="w-6 text-sm text-muted-foreground">{{ i + 1 }}</text>
          <text class="flex-1 text-base text-foreground">{{ track }}</text>
        </view>
      }
      <!-- Another tab, from a pushed screen: the Library's stack leaves with
           its tab, and the dock comes back on Search at once. -->
      <view
        class="items-center rounded-full bg-secondary px-4 py-3 flex"
        [accessibility-element]="true"
        accessibility-traits="button"
        [accessibility-label]="'More by ' + album().artist"
        routerLink="/search"
      >
        <text class="text-sm font-medium text-secondary-foreground"
          >More by {{ album().artist }}</text
        >
      </view>
    </app-screen>
  `,
})
export class AlbumScreen {
  protected readonly player = inject(Player);
  protected readonly tracks = [
    'Overture',
    'Shoreline',
    'Paper Moon',
    'Undertow',
    'Glass House',
    'Slow Bloom',
    'Northbound',
    'Afterglow',
    'Static',
    'Harbor',
    'Late Train',
    'Coda',
  ];

  readonly #id = toSignal(inject(ActivatedRoute).paramMap, {
    requireSync: true,
  });

  protected readonly album = computed(
    () =>
      ALBUMS.find((album) => album.id === Number(this.#id().get('album'))) ??
      ALBUMS[0],
  );
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
