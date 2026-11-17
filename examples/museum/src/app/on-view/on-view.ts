import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LYNX_ELEMENTS,
  type LynxEvent,
  type LynxListItemAttributes,
  type ListScrollDetail,
} from '@blotch/angular-lynx';
import type { Artwork } from '../data/artwork';
import { BAY_HEIGHT, type Bay, BayView, hang } from '../wall/bay';
import { Daylight, Trouble } from '../wall/states';
import { TopBar } from '../wall/top-bar';
import { OnViewWall } from './on-view-wall';

/** How far the wall scrolls before its large title is under the top bar. */
const TITLE_UNDER = 120;

/**
 * What's on view now: the museum's highlights hanging in its galleries,
 * live from its API, as a glazed wall that loads more as it's scrolled.
 *
 * The wall is a virtualized `<list>`: each bay is one item, built as it
 * scrolls into view and reused for the bays scrolled to after it leaves.
 */
@Component({
  selector: 'app-on-view',
  imports: [LYNX_ELEMENTS, BayView, Daylight, TopBar, Trouble],
  host: { class: 'relative flex flex-1 flex-col bg-bar' },
  template: `
    <list
      class="flex-1"
      list-type="single"
      scroll-orientation="vertical"
      [lower-threshold-item-count]="4"
      [scroll-event-throttle]="50"
      [preload-buffer-count]="2"
      style="list-main-axis-gap: 6px"
      (bindscroll)="scrolled($event)"
      (bindscrolltolower)="wall.more()"
    >
      <list-item item-key="transom">
        <view class="flex flex-col gap-1.5 px-1.5">
          <view class="pt-status"></view>
          <view class="flex flex-row gap-1.5">
            <!-- Two lines, big and tight, filling the transom: Lynx's
                 <text> keeps no line break it's given, so each line is a
                 text of its own, and the pane is the heading. -->
            <view
              class="pane flex flex-1 flex-col justify-end px-4 pt-5 pb-2"
              accessibility-element="true"
              accessibility-traits="header"
              accessibility-label="On view now"
            >
              <text class="display text-[68px] leading-[60px]">ON VIEW</text>
              <text class="display text-[68px] leading-[60px]">NOW</text>
            </view>
            <view
              class="pane-cobalt flex w-[92px] flex-col justify-end px-3 pb-3"
              accessibility-element="true"
              [attr.accessibility-label]="countLabel()"
            >
              @if (wall.total(); as total) {
                <text
                  class="display text-[40px] leading-[40px] text-on-color"
                  >{{ total }}</text
                >
                <text class="label text-[11px] text-on-color">WORKS</text>
              }
            </view>
          </view>
          @if (wall.offline()) {
            <app-trouble
              title="The museum can't be reached."
              detail="This is the wall as it hung on 16 November 2026."
              (pressed)="wall.retry()"
            />
          } @else {
            <view class="pane pane-seed px-4 py-3">
              <text class="text-[15px] leading-[21px] text-ink-soft"
                >Hanging in the Cleveland Museum of Art's galleries today, live
                from its open-access collection.</text
              >
            </view>
          }
        </view>
      </list-item>

      <list-item
        *lynxListFor="let bay of bays(); trackBy: byKey; itemAttributes: layout"
      >
        <app-bay
          class="px-1.5"
          context="on-view"
          [bay]="bay"
          (opened)="open($event)"
        />
      </list-item>

      <list-item item-key="end">
        <view class="pb-tab-bar flex flex-col gap-1.5 px-1.5">
          @switch (wall.status()) {
            @case ('loading') {
              <app-daylight [count]="wall.works().length ? 1 : 3" />
            }
            @case ('error') {
              @if (!wall.offline()) {
                <app-trouble
                  title="The next works failed to load."
                  detail="Check the connection and try again."
                  (pressed)="wall.retry()"
                />
              }
            }
            @case ('done') {
              <view class="pane pane-seed px-4 py-4">
                <text class="text-[15px] leading-[21px] text-ink-soft"
                  >That's the whole wall. Search the collection for the works in
                  storage.</text
                >
              </view>
            }
          }
        </view>
      </list-item>
    </list>

    <app-top-bar title="On view" [shown]="titleUnder()" />
  `,
})
export class OnView {
  protected readonly wall = inject(OnViewWall);
  readonly #router = inject(Router);
  readonly #route = inject(ActivatedRoute);

  protected readonly bays = computed(() => hang(this.wall.works()));
  protected readonly titleUnder = signal(false);
  protected readonly countLabel = computed(() => {
    const total = this.wall.total();
    return total === null ? 'Loading' : `${total} works on view`;
  });

  protected readonly byKey = (_: number, bay: Bay) => bay.key;
  protected readonly layout = (bay: Bay): LynxListItemAttributes => ({
    'reuse-identifier': bay.kind,
    'estimated-main-axis-size-px': BAY_HEIGHT[bay.kind],
  });

  protected scrolled(event: LynxEvent<ListScrollDetail>): void {
    const under = event.detail.scrollTop > TITLE_UNDER;
    if (under !== this.titleUnder()) this.titleUnder.set(under);
  }

  protected open(work: Artwork): void {
    void this.#router.navigate(['work', work.id], { relativeTo: this.#route });
  }
}
