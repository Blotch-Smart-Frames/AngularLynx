import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LYNX_ELEMENTS,
  type ListScrollDetail,
  type LynxEvent,
  type LynxListItemAttributes,
} from '@blotch/angular-lynx';
import type { Artwork } from '../data/artwork';
import { SavedWorks } from '../state/saved';
import { BAY_HEIGHT, type Bay, BayView, hang } from '../wall/bay';
import { BlankWall } from '../wall/states';
import { TopBar } from '../wall/top-bar';

const TITLE_UNDER = 120;

/**
 * The works the person saved, hung as a wall of their own. They're stored
 * whole, so the wall hangs with no network; a work's screen loads the rest
 * of its record when it can.
 */
@Component({
  selector: 'app-saved',
  imports: [LYNX_ELEMENTS, BayView, BlankWall, TopBar],
  host: { class: 'relative flex flex-1 flex-col bg-bar' },
  template: `
    <list
      class="flex-1"
      list-type="single"
      scroll-orientation="vertical"
      [scroll-event-throttle]="50"
      style="list-main-axis-gap: 6px"
      (bindscroll)="scrolled($event)"
    >
      <list-item item-key="transom">
        <view class="flex flex-col gap-1.5 px-1.5">
          <view class="pt-status"></view>
          <view class="flex flex-row gap-1.5">
            <view class="pane flex flex-1 flex-col justify-end px-4 pt-6 pb-3">
              <text
                class="display text-[68px] leading-[60px]"
                accessibility-traits="header"
                >SAVED</text
              >
            </view>
            <view
              class="flex w-[92px] flex-col justify-end px-3 pb-3"
              [class.pane-amber]="saved.count() > 0"
              [class.pane-seed]="saved.count() === 0"
              accessibility-element="true"
              [attr.accessibility-label]="saved.count() + ' saved'"
            >
              <text class="display text-[40px] leading-[40px] text-ink">{{
                saved.count()
              }}</text>
              <text class="label text-[11px] text-ink">{{
                saved.count() === 1 ? 'WORK' : 'WORKS'
              }}</text>
            </view>
          </view>
          @if (saved.count() === 0) {
            <view class="pane pane-seed flex flex-col gap-2 px-4 pt-4 pb-5">
              <text class="font-strong text-[19px] leading-[24px]"
                >Nothing saved yet.</text
              >
              <text class="text-[15px] leading-[21px] text-ink-soft"
                >Open a work and tap Save. It stays here, with its picture and
                details, even when there's no connection.</text
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
          context="saved"
          [bay]="bay"
          (opened)="open($event)"
        />
      </list-item>

      <list-item item-key="end">
        <view class="pb-tab-bar px-1.5">
          <app-blank-wall />
        </view>
      </list-item>
    </list>

    <app-top-bar title="Saved" [shown]="titleUnder()" />
  `,
})
export class Saved {
  protected readonly saved = inject(SavedWorks);
  readonly #router = inject(Router);
  readonly #route = inject(ActivatedRoute);

  protected readonly bays = computed(() => hang(this.saved.works()));
  protected readonly titleUnder = signal(false);

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
