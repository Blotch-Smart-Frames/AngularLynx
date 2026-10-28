import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { UiContextMenu } from '../components/ui/context-menu';
import { UiGlass, injectGlassDesign } from '../components/ui/glass';
import { UiIcon } from '../components/ui/icon';
import {
  UiMenu,
  UiMenuItem,
  UiMenuSection,
  UiMenuSeparator,
  UiMenuTrigger,
} from '../components/ui/menu';

type Trip = {
  readonly name: string;
  readonly dates: string;
  readonly sky: string;
};

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiContextMenu,
    UiGlass,
    UiIcon,
    UiMenu,
    UiMenuItem,
    UiMenuSection,
    UiMenuSeparator,
    UiMenuTrigger,
  ],
  template: `
    <view class="h-full w-full flex-col bg-background flex">
      <scroll-view scroll-orientation="vertical" class="flex-1">
        <view class="flex-col gap-6 px-4 pb-10 flex pt-safe-6">
          <view class="flex-row items-start gap-3 flex">
            <view class="flex-1 flex-col gap-1 flex">
              <text class="text-2xl font-bold text-foreground">Menus</text>
              <text class="text-sm text-muted-foreground">
                Context menus and pull-down menus, in Liquid Glass.
              </text>
              <text class="text-xs text-muted-foreground">{{ status() }}</text>
            </view>
            <!-- A pull-down menu from a glass button in the corner: it grows
               out of the button, toward the middle of the screen. -->
            <ui-menu>
              <blur-view
                ui-glass
                uiMenuTrigger
                shape="circle"
                interactive
                class="h-11 w-11 items-center flex justify-center"
                [accessibility-element]="true"
                accessibility-traits="button"
                accessibility-label="More"
              >
                <ui-icon name="ellipsis" />
              </blur-view>
              <ui-menu-section title="Sort by">
                <ui-menu-item
                  label="Name"
                  [checked]="sort() === 'name'"
                  (pressed)="sortBy('name')"
                />
                <ui-menu-item
                  label="Date"
                  [checked]="sort() === 'date'"
                  (pressed)="sortBy('date')"
                />
              </ui-menu-section>
              <ui-menu-separator />
              <ui-menu-item
                label="Select"
                icon="list-checks"
                (pressed)="did('Select')"
              />
              <ui-menu-item
                label="New trip"
                icon="plus"
                (pressed)="did('New trip')"
              />
            </ui-menu>
          </view>

          <view class="flex-col gap-3 flex">
            <text class="text-sm font-semibold text-foreground">
              Context menu
            </text>
            <text class="text-xs text-muted-foreground">
              Long press a trip. Last action: {{ lastAction() }}
            </text>
            @for (trip of trips(); track trip.name) {
              <ui-context-menu>
                <view
                  class="h-[96px] flex-col rounded-[20px] p-4 flex justify-end"
                  [style.background-image]="trip.sky"
                  (bindtap)="did('Opened ' + trip.name)"
                >
                  <text class="text-lg font-semibold text-white">
                    {{ trip.name }}
                  </text>
                  <text class="text-sm text-white">{{ trip.dates }}</text>
                </view>
                <ui-menu-item
                  label="Share"
                  icon="upload"
                  (pressed)="did('Shared ' + trip.name)"
                />
                <ui-menu-item
                  label="Favorite"
                  icon="heart"
                  (pressed)="did('Saved ' + trip.name)"
                />
                <ui-menu-item
                  label="Duplicate"
                  icon="copy"
                  (pressed)="did('Duplicated ' + trip.name)"
                />
                <ui-menu-separator />
                <ui-menu-item
                  label="Delete"
                  icon="trash"
                  variant="destructive"
                  (pressed)="remove(trip)"
                />
              </ui-context-menu>
            }
          </view>
        </view>
      </scroll-view>
      <!-- A toolbar along the bottom: its menu opens upward, and stays clear
         of the home indicator. -->
      <view class="flex-row items-center gap-3 px-4 pt-2 flex pb-safe-2">
        <ui-menu>
          <blur-view
            ui-glass
            uiMenuTrigger
            interactive
            class="h-11 flex-row items-center gap-2 px-4 flex"
            [accessibility-element]="true"
            accessibility-traits="button"
            accessibility-label="Filter"
          >
            <ui-icon name="filter" size="sm" />
            <text class="text-sm font-medium text-glass-foreground">
              {{ filter() }}
            </text>
          </blur-view>
          <ui-menu-item
            label="Upcoming"
            icon="calendar"
            [checked]="filter() === 'Upcoming'"
            (pressed)="filterBy('Upcoming')"
          />
          <ui-menu-item
            label="Past"
            icon="clock"
            [checked]="filter() === 'Past'"
            (pressed)="filterBy('Past')"
          />
          <ui-menu-item label="Archived" icon="archive" disabled />
        </ui-menu>
        <text class="flex-1 text-xs text-muted-foreground">
          Near the bottom of the screen, a menu opens upward.
        </text>
      </view>
    </view>
  `,
})
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #info = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  readonly lastAction = signal('none');
  readonly sort = signal<'name' | 'date'>('date');
  readonly filter = signal<'Upcoming' | 'Past'>('Upcoming');
  readonly trips = signal<readonly Trip[]>([
    {
      name: 'Kyoto',
      dates: 'Apr 2 – Apr 9',
      sky: 'linear-gradient(135deg, #f472b6, #fb923c)',
    },
    {
      name: 'Oslo',
      dates: 'Jun 14 – Jun 20',
      sky: 'linear-gradient(135deg, #38bdf8, #6366f1)',
    },
    {
      name: 'Lisbon',
      dates: 'Sep 3 – Sep 10',
      sky: 'linear-gradient(135deg, #facc15, #f97316)',
    },
  ]);

  /** What the menus draw here, and the user's Reduce Motion setting. */
  readonly status = computed(
    () =>
      `${this.#design()} on ${this.#info.platform} ${this.#info.osVersion}` +
      (this.#settings.reduceMotion() ? ', Reduce Motion' : ''),
  );

  did(action: string): void {
    this.lastAction.set(action);
  }

  sortBy(sort: 'name' | 'date'): void {
    this.sort.set(sort);
    this.did(`Sorted by ${sort}`);
  }

  filterBy(filter: 'Upcoming' | 'Past'): void {
    this.filter.set(filter);
    this.did(`Showing ${filter.toLowerCase()} trips`);
  }

  remove(trip: Trip): void {
    this.trips.update((trips) => trips.filter((other) => other !== trip));
    this.did(`Deleted ${trip.name}`);
  }
}
