import { UpperCasePipe } from '@angular/common';
import { Component, inject, input, output } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import type { Artwork } from '../data/artwork';
import { SavedWorks } from '../state/saved';
import { Picture } from './picture';
import { Press } from './press';

/**
 * A bay of the wall: the panes between two heavy mullions, one row of the
 * list. A wall that repeats one pane size reads as a feed, so bays take
 * turns:
 *
 * - `lead`: one work in the widest pane, at its own proportions, with a
 *   rail beside it carrying its gallery number.
 * - `offset`: one work beside a seeded pane that names it, larger.
 * - `pair`: two works side by side, cropped to equal panes; every other
 *   pair has its number panes on the left (`mirrored`), so the wall's
 *   narrow panes don't stack in one column.
 */
export type Bay = {
  readonly key: string;
  readonly kind: 'lead' | 'pair' | 'offset';
  readonly works: readonly Artwork[];
  readonly mirrored: boolean;
};

const ORDER: readonly Bay['kind'][] = ['lead', 'offset', 'pair', 'pair'];

/**
 * Where a wall hangs, which decides what its colored glass says: a color
 * that marks every pane marks nothing. On View is all on view, so a rail
 * there is seeded glass with the number in cobalt; Saved is all saved, so
 * no rail there turns amber.
 */
export type WallContext = 'on-view' | 'search' | 'saved';

type Rail = 'amber' | 'cobalt' | 'seed';

/**
 * Hangs `works` in bays, in order. The same works always hang the same way,
 * so loading another page leaves the bays above it as they were: only the
 * last one can change, when a lone work gains its pair.
 */
export const hang = (works: readonly Artwork[]): Bay[] => {
  const bays: Bay[] = [];
  let at = 0;
  for (let turn = 0; at < works.length; turn++) {
    let kind = ORDER[turn % ORDER.length]!;
    if (kind === 'pair' && at + 1 >= works.length) kind = 'offset';
    const size = kind === 'pair' ? 2 : 1;
    const hung = works.slice(at, at + size);
    bays.push({
      key: `${kind}-${hung[0]!.id}`,
      kind,
      works: hung,
      mirrored: turn % ORDER.length === 3,
    });
    at += size;
  }
  return bays;
};

/** How tall a list item holding each kind of bay is, near enough. */
export const BAY_HEIGHT: Readonly<Record<Bay['kind'], number>> = {
  lead: 420,
  pair: 286,
  offset: 236,
};

/**
 * A lead work's pane keeps the work's proportions, within reason: a tall
 * portrait would otherwise fill the screen, and a long scroll painting
 * shrink to a strip.
 */
const leadRatio = (work: Artwork): number =>
  Math.min(1.6, Math.max(0.78, work.image.width / work.image.height));

@Component({
  selector: 'app-bay',
  imports: [LYNX_ELEMENTS, UpperCasePipe, Picture, Press],
  host: { class: 'flex flex-col' },
  template: `
    @let works = bay().works;
    @switch (bay().kind) {
      @case ('lead') {
        @let work = works[0]!;
        <view class="flex flex-col gap-1.5">
          <view class="flex flex-row gap-1.5">
            <app-picture
              appPress
              class="glow flex-1"
              [style.aspect-ratio]="ratio(work)"
              [work]="work"
              (bindtap)="opened.emit(work)"
            />
            @let leadRail = rail(work) ?? 'seed';
            <view
              class="flex w-[56px] flex-col items-center justify-start pt-3"
              [class.pane-amber]="leadRail === 'amber'"
              [class.pane-cobalt]="leadRail === 'cobalt'"
              [class.pane-seed]="leadRail === 'seed'"
            >
              @if (work.gallery; as gallery) {
                <text
                  class="label text-[10px]"
                  [class.text-on-color]="leadRail === 'cobalt'"
                  [class.text-ink]="leadRail !== 'cobalt'"
                  >GALLERY</text
                >
                <text
                  class="display text-[26px] leading-[30px]"
                  [class.text-on-color]="leadRail === 'cobalt'"
                  [class.text-cobalt]="leadRail === 'seed'"
                  [class.text-ink]="leadRail === 'amber'"
                  >{{ gallery.number }}</text
                >
              }
            </view>
          </view>
          <view
            appPress
            class="pane flex flex-col gap-1 px-4 pt-3 pb-4"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="describe(work)"
            (bindtap)="opened.emit(work)"
          >
            <text
              class="display text-[28px] leading-[30px] text-ellipsis"
              [text-maxline]="2"
              >{{ work.title | uppercase }}</text
            >
            <text
              class="text-[15px] leading-[20px] text-ellipsis text-ink-soft"
              [text-maxline]="1"
              >{{ byline(work) }}</text
            >
          </view>
        </view>
      }
      @case ('pair') {
        <view class="flex flex-row gap-1.5">
          @for (work of works; track work.id) {
            <view class="flex flex-1 flex-col gap-1.5">
              <app-picture
                appPress
                class="glow h-[196px]"
                [work]="work"
                (bindtap)="opened.emit(work)"
              />
              @let pairRail = rail(work);
              <view
                class="flex h-[84px] gap-1.5"
                [class.flex-row]="!bay().mirrored"
                [class.flex-row-reverse]="bay().mirrored"
              >
                <view
                  appPress
                  class="pane flex flex-1 flex-col justify-between px-3 pt-2.5 pb-3"
                  accessibility-element="true"
                  accessibility-traits="button"
                  [attr.accessibility-label]="describe(work)"
                  (bindtap)="opened.emit(work)"
                >
                  <text
                    class="font-strong text-[15px] leading-[19px] text-ellipsis"
                    [text-maxline]="2"
                    >{{ work.title }}</text
                  >
                  <text
                    class="text-[13px] leading-[17px] text-ellipsis text-ink-soft"
                    [text-maxline]="1"
                    >{{ work.maker ?? work.date }}</text
                  >
                </view>
                @if (pairRail) {
                  <view
                    class="flex w-[40px] flex-col items-center justify-center"
                    [class.pane-amber]="pairRail === 'amber'"
                    [class.pane-cobalt]="pairRail === 'cobalt'"
                    [class.pane-seed]="pairRail === 'seed'"
                  >
                    <text
                      class="display text-[17px]"
                      [class.text-on-color]="pairRail === 'cobalt'"
                      [class.text-cobalt]="pairRail === 'seed'"
                      [class.text-ink]="pairRail === 'amber'"
                      >{{ work.gallery?.number ?? '' }}</text
                    >
                  </view>
                }
              </view>
            </view>
          }
        </view>
      }
      @case ('offset') {
        @let work = works[0]!;
        <view class="flex h-[230px] flex-row gap-1.5">
          <view
            appPress
            class="pane pane-seed flex w-[38%] flex-col justify-between px-4 pt-3 pb-4"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="describe(work)"
            (bindtap)="opened.emit(work)"
          >
            <view class="flex flex-col gap-1.5">
              <text
                class="display text-[24px] leading-[26px] text-ellipsis"
                [text-maxline]="4"
                >{{ work.title | uppercase }}</text
              >
              <text
                class="text-[14px] leading-[19px] text-ellipsis text-ink-soft"
                [text-maxline]="2"
                >{{ byline(work) }}</text
              >
            </view>
            @if (work.gallery; as gallery) {
              <text class="label text-cobalt"
                >GALLERY {{ gallery.number }}</text
              >
            }
          </view>
          <app-picture
            appPress
            class="glow flex-1"
            [work]="work"
            (bindtap)="opened.emit(work)"
          />
        </view>
      }
    }
  `,
})
export class BayView {
  readonly bay = input.required<Bay>();
  readonly context = input<WallContext>('search');
  readonly opened = output<Artwork>();

  readonly #saved = inject(SavedWorks);
  protected readonly ratio = leadRatio;

  /**
   * The glass of a work's rail, the narrow pane with its gallery number:
   * amber once it's saved, cobalt where being on view sets it apart from
   * works in storage, seeded where every work is on view. None for a work
   * in storage that isn't saved, which has no number to carry.
   */
  protected rail(work: Artwork): Rail | null {
    if (this.context() !== 'saved' && this.#saved.has(work.id)) return 'amber';
    if (!work.gallery) return null;
    return this.context() === 'on-view' ? 'seed' : 'cobalt';
  }

  protected byline(work: Artwork): string {
    return [work.maker, work.date].filter(Boolean).join(', ');
  }

  protected describe(work: Artwork): string {
    const where = work.gallery ? `, gallery ${work.gallery.number}` : '';
    return `${work.title}${work.maker ? `, ${work.maker}` : ''}${where}`;
  }
}
