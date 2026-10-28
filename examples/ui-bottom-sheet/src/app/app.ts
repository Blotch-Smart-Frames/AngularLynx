import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { type SheetDetent, UiBottomSheet } from '../components/ui/bottom-sheet';
import { UiButton } from '../components/ui/button';
import { injectGlassDesign } from '../components/ui/glass';
import { UiIcon } from '../components/ui/icon';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiBottomSheet, UiButton, UiIcon],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-4 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Bottom Sheet</text>
        <text class="text-sm text-muted-foreground">
          Drag the handle down or tap the backdrop to close a sheet.
        </text>

        <ui-button variant="outline" (pressed)="sortOpen.set(true)">
          Sort by: {{ sort() }}
        </ui-button>
        <ui-button variant="outline" (pressed)="countryOpen.set(true)">
          Country: {{ country() }}
        </ui-button>
        <text class="text-xs text-muted-foreground">
          Sheets closed: {{ closedCount() }}
        </text>

        <!-- Glass: each platform's own sheet. Over this colorful page, the
             inset glass of iOS 26 shows what's behind it. -->
        <text class="text-lg font-semibold text-foreground">Glass</text>
        <text class="text-xs text-muted-foreground">{{ status() }}</text>
        <ui-button variant="outline" (pressed)="placesOpen.set(true)">
          Places: {{ place() }}
        </ui-button>
        <ui-button variant="outline" (pressed)="filterOpen.set(true)">
          Filter: {{ filter() }}
        </ui-button>
        @for (row of photos; track $index) {
          <view class="flex-row gap-3 flex">
            @for (photo of row; track $index) {
              <view
                class="h-32 flex-1 rounded-2xl"
                [style.background-image]="photo"
              ></view>
            }
          </view>
        }
      </view>
    </scroll-view>

    <!-- Short content: the panel grows to fit its rows -->
    <ui-bottom-sheet [(open)]="sortOpen" (closed)="onClosed()">
      <text class="px-6 pb-2 text-lg font-semibold text-foreground">
        Sort by
      </text>
      @for (option of sortOptions; track option) {
        <view
          class="flex-row items-center px-6 py-3 flex justify-between"
          (bindtap)="chooseSort(option)"
        >
          <text class="text-base text-foreground">{{ option }}</text>
          @if (option === sort()) {
            <ui-icon name="check" size="sm" />
          }
        </view>
      }
    </ui-bottom-sheet>

    <!-- Long content: a fixed-height scroll-view, since the panel has no max height -->
    <ui-bottom-sheet [(open)]="countryOpen" (closed)="onClosed()">
      <text class="px-6 pb-2 text-lg font-semibold text-foreground">
        Country
      </text>
      <scroll-view scroll-orientation="vertical" class="h-80">
        @for (option of countries; track option) {
          <view
            class="flex-row items-center px-6 py-3 flex justify-between"
            (bindtap)="chooseCountry(option)"
          >
            <text class="text-base text-foreground">{{ option }}</text>
            @if (option === country()) {
              <ui-icon name="check" size="sm" />
            }
          </view>
        }
      </scroll-view>
    </ui-bottom-sheet>

    <!-- Glass at half height and full height: drag the handle or tap it to
         move between them. A flex-1 scroll view takes the height that's left. -->
    <ui-bottom-sheet
      variant="glass"
      [detents]="['medium', 'large']"
      [(open)]="placesOpen"
      [(detent)]="placesDetent"
    >
      <view class="flex-row items-center px-6 pb-2 flex justify-between">
        <text class="text-lg font-semibold text-foreground">Places</text>
        <text class="text-xs text-muted-foreground">
          {{ placesDetent() ?? '' }}
        </text>
      </view>
      <scroll-view scroll-orientation="vertical" class="flex-1">
        @for (option of countries; track option) {
          <view
            class="flex-row items-center px-6 py-3 flex justify-between"
            (bindtap)="choosePlace(option)"
          >
            <text class="text-base text-foreground">{{ option }}</text>
            @if (option === place()) {
              <ui-icon name="check" size="sm" />
            }
          </view>
        }
      </scroll-view>
    </ui-bottom-sheet>

    <!-- Glass that fits its content -->
    <ui-bottom-sheet variant="glass" [(open)]="filterOpen">
      <text class="px-6 pb-2 text-lg font-semibold text-foreground">
        Filter
      </text>
      @for (option of filters; track option) {
        <view
          class="flex-row items-center px-6 py-3 flex justify-between"
          (bindtap)="chooseFilter(option)"
        >
          <text class="text-base text-foreground">{{ option }}</text>
          @if (option === filter()) {
            <ui-icon name="check" size="sm" />
          }
        </view>
      }
    </ui-bottom-sheet>
  `,
})
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  protected readonly sortOptions = [
    'Newest',
    'Oldest',
    'Most popular',
    'Price: low to high',
    'Price: high to low',
  ];
  protected readonly countries = [
    'Australia',
    'Brazil',
    'Canada',
    'France',
    'Germany',
    'India',
    'Italy',
    'Japan',
    'Mexico',
    'Netherlands',
    'New Zealand',
    'Norway',
    'Singapore',
    'South Korea',
    'Spain',
    'Sweden',
    'United Kingdom',
    'United States',
  ];
  protected readonly filters = ['All', 'Favorites', 'Visited', 'Want to go'];
  /** Gradient "photos" for the glass to show around it. */
  protected readonly photos = [
    [
      'linear-gradient(135deg, #22d3ee, #6366f1)',
      'linear-gradient(135deg, #f472b6, #f59e0b)',
    ],
    [
      'linear-gradient(135deg, #34d399, #0ea5e9)',
      'linear-gradient(135deg, #a855f7, #ec4899)',
    ],
    [
      'linear-gradient(135deg, #fb923c, #ef4444)',
      'linear-gradient(135deg, #4ade80, #14b8a6)',
    ],
    [
      'linear-gradient(135deg, #818cf8, #22d3ee)',
      'linear-gradient(135deg, #facc15, #f97316)',
    ],
  ];

  protected readonly sortOpen = signal(false);
  protected readonly countryOpen = signal(false);
  protected readonly placesOpen = signal(false);
  protected readonly filterOpen = signal(false);
  protected readonly placesDetent = signal<SheetDetent | undefined>(undefined);
  protected readonly sort = signal('Newest');
  protected readonly country = signal('United Kingdom');
  protected readonly place = signal('Japan');
  protected readonly filter = signal('All');
  protected readonly closedCount = signal(0);

  /** What the glass sheets draw here, and the setting they follow. */
  protected readonly status = computed(() => {
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    const motion = this.#settings.reduceMotion() ? 'on' : 'off';
    return `Design: ${this.#design()} on ${os} · Reduce Motion: ${motion}`;
  });

  protected chooseSort(option: string): void {
    this.sort.set(option);
    this.sortOpen.set(false);
  }

  protected chooseCountry(option: string): void {
    this.country.set(option);
    this.countryOpen.set(false);
  }

  protected choosePlace(option: string): void {
    this.place.set(option);
    this.placesOpen.set(false);
  }

  protected chooseFilter(option: string): void {
    this.filter.set(option);
    this.filterOpen.set(false);
  }

  /**
   * `closed` fires once the slide-down animation has finished, however the
   * sheet was closed: a row tap, a backdrop tap or a drag on the handle.
   */
  protected onClosed(): void {
    this.closedCount.update((count) => count + 1);
  }
}
