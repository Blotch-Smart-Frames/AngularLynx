import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBottomSheet } from '../components/ui/bottom-sheet';
import { UiButton } from '../components/ui/button';
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
  `,
})
export class App {
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

  protected readonly sortOpen = signal(false);
  protected readonly countryOpen = signal(false);
  protected readonly sort = signal('Newest');
  protected readonly country = signal('United Kingdom');
  protected readonly closedCount = signal(0);

  protected chooseSort(option: string): void {
    this.sort.set(option);
    this.sortOpen.set(false);
  }

  protected chooseCountry(option: string): void {
    this.country.set(option);
    this.countryOpen.set(false);
  }

  /**
   * `closed` fires once the slide-down animation has finished, however the
   * sheet was closed: a row tap, a backdrop tap or a drag on the handle.
   */
  protected onClosed(): void {
    this.closedCount.update((count) => count + 1);
  }
}
