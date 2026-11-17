import { UpperCasePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LYNX_ELEMENTS,
  type LynxEvent,
  LynxLinking,
  LynxShare,
  type ScrollDetail,
} from '@blotch/angular-lynx';
import { API, type Artwork, type RawArtwork, toDetail } from '../data/artwork';
import { Museum } from '../data/museum';
import { SavedWorks } from '../state/saved';
import { Picture } from '../wall/picture';
import { Press } from '../wall/press';
import { Daylight, Trouble } from '../wall/states';
import { TopBar } from '../wall/top-bar';

/** Each tab's first screen, as Back names it. */
const TAB_NAMES: Readonly<Record<string, string>> = {
  'on-view': 'On view',
  search: 'Search',
  saved: 'Saved',
};

/**
 * One work, a pane per statement: the picture behind its glass, what you
 * can do with it, its title and maker, where it hangs, its facts, and what
 * the museum says about it.
 *
 * The picture and title come at once from the list that opened it (or from
 * Saved, with no network); the rest of the record loads with
 * `httpResource`, keyed by the route's id.
 */
@Component({
  selector: 'app-artwork',
  imports: [
    LYNX_ELEMENTS,
    UpperCasePipe,
    Daylight,
    Picture,
    Press,
    TopBar,
    Trouble,
  ],
  host: { class: 'relative flex flex-1 flex-col bg-bar' },
  template: `
    <scroll-view
      class="flex-1"
      scroll-orientation="vertical"
      [scroll-event-throttle]="50"
      (bindscroll)="scrolled($event)"
    >
      <view class="pt-top-bar pb-home-6 flex flex-col gap-1.5 px-1.5">
        @if (work(); as work) {
          <view
            appPress
            class="pane flex flex-col p-4"
            accessibility-element="true"
            accessibility-traits="button"
            accessibility-label="Zoom into the picture"
            (bindtap)="zoom()"
          >
            <app-picture
              class="w-full"
              [style.aspect-ratio]="ratio()"
              [work]="work"
              [fit]="true"
            />
          </view>

          <view class="flex h-[56px] flex-row gap-1.5">
            <view
              appPress
              class="pane flex flex-1 flex-col justify-center px-3"
              [class.pane-amber]="isSaved()"
              accessibility-element="true"
              accessibility-traits="button"
              [attr.accessibility-label]="
                isSaved() ? 'Saved. Tap to remove.' : 'Save'
              "
              (bindtap)="saved.toggle(work)"
            >
              <text class="label text-ink">{{
                isSaved() ? 'SAVED' : 'SAVE'
              }}</text>
            </view>
            <view
              appPress
              class="pane flex flex-1 flex-col justify-center px-3"
              accessibility-element="true"
              accessibility-traits="button"
              accessibility-label="Zoom in"
              (bindtap)="zoom()"
            >
              <text class="label text-ink">ZOOM IN</text>
            </view>
            <view
              appPress
              class="pane flex flex-1 flex-col justify-center px-3"
              accessibility-element="true"
              accessibility-traits="button"
              accessibility-label="Share"
              (bindtap)="share(work)"
            >
              <text class="label text-ink">SHARE</text>
            </view>
          </view>

          <view class="pane flex flex-col gap-1.5 px-4 pt-4 pb-5">
            <text
              class="display text-[34px] leading-[34px]"
              accessibility-traits="header"
              [attr.accessibility-label]="work.title"
              >{{ work.title | uppercase }}</text
            >
            @if (work.maker) {
              <text class="font-strong text-[17px] leading-[22px]">{{
                work.maker
              }}</text>
            }
            @if (work.makerNote) {
              <text class="text-[15px] leading-[20px] text-ink-soft">{{
                work.makerNote
              }}</text>
            }
          </view>

          @if (work.gallery; as gallery) {
            <view class="flex flex-row gap-1.5">
              <view
                class="pane-cobalt flex flex-1 flex-col justify-center gap-0.5 px-4 py-3"
              >
                <text class="label text-[11px] text-on-color">ON VIEW</text>
                <text class="text-[17px] leading-[22px] text-on-color">{{
                  gallery.name
                }}</text>
              </view>
              <view
                class="pane-cobalt flex w-[92px] flex-col justify-end px-3 pb-3"
              >
                <text class="label text-[10px] text-on-color">GALLERY</text>
                <text
                  class="display text-[34px] leading-[34px] text-on-color"
                  >{{ gallery.number }}</text
                >
              </view>
            </view>
          } @else {
            <view class="pane pane-seed px-4 py-3">
              <text class="text-[15px] leading-[21px] text-ink-soft"
                >Not on view: it's in the museum's storage.</text
              >
            </view>
          }

          @for (row of facts(); track $index) {
            <view class="flex flex-row gap-1.5">
              @for (fact of row; track fact.label) {
                <view class="pane flex flex-1 flex-col gap-1 px-4 pt-3 pb-3.5">
                  <text class="label text-[11px] text-ink-soft">{{
                    fact.label | uppercase
                  }}</text>
                  <text class="text-[16px] leading-[21px]">{{
                    fact.value
                  }}</text>
                </view>
              }
            </view>
          }

          @if (record.isLoading()) {
            <app-daylight [count]="1" />
          } @else if (record.error()) {
            <app-trouble
              title="The rest of its record failed to load."
              detail="Check the connection and try again."
              (pressed)="record.reload()"
            />
          }

          @if (detail(); as detail) {
            @if (detail.didYouKnow) {
              <view class="pane pane-seed px-4 pt-4 pb-5">
                <text class="text-[21px] leading-[28px]">{{
                  detail.didYouKnow
                }}</text>
              </view>
            }
            @if (detail.description) {
              <view class="pane px-4 pt-4 pb-5">
                <text class="text-[16px] leading-[25px]">{{
                  detail.description
                }}</text>
              </view>
            }
            <view class="pane pane-seed flex flex-col gap-2 px-4 pt-4 pb-5">
              @if (detail.creditLine) {
                <text class="text-[14px] leading-[20px] text-ink-soft">{{
                  detail.creditLine
                }}</text>
              }
              <text class="text-[14px] leading-[20px] text-ink-soft"
                >Record and picture: the Cleveland Museum of Art, Open Access,
                CC0.</text
              >
            </view>
            @if (detail.url; as url) {
              <view
                appPress
                class="pane flex h-[56px] flex-row items-center justify-between px-4"
                accessibility-element="true"
                accessibility-traits="link"
                accessibility-label="Open its page on the museum's site"
                (bindtap)="visit(url)"
              >
                <text class="label text-ink">ON THE MUSEUM'S SITE</text>
                <text class="label text-[11px] text-ink-soft"
                  >CLEVELANDART.ORG</text
                >
              </view>
            }
          }
        } @else if (record.error()) {
          <app-trouble
            title="This work failed to load."
            detail="Check the connection and try again."
            (pressed)="record.reload()"
          />
        } @else {
          <app-daylight [count]="3" />
        }
      </view>
    </scroll-view>

    <app-top-bar
      [title]="work()?.title ?? ''"
      [back]="backLabel"
      [backRoute]="backRoute"
      [titleShown]="titleShown()"
    />
  `,
})
export class ArtworkScreen {
  /** The route's `:id`, bound by `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  protected readonly saved = inject(SavedWorks);
  readonly #museum = inject(Museum);
  readonly #router = inject(Router);
  readonly #route = inject(ActivatedRoute);
  readonly #share = inject(LynxShare);
  readonly #linking = inject(LynxLinking);

  /** The tab this screen is in, for Back. */
  readonly #tab =
    this.#route.snapshot.pathFromRoot[1]?.routeConfig?.path ?? 'on-view';
  protected readonly backLabel = TAB_NAMES[this.#tab] ?? 'Back';
  protected readonly backRoute = `/${this.#tab}`;

  /** The whole record. The API wraps it: `{ data: { … } }`. */
  protected readonly record = httpResource(() => `${API}${this.id()}`, {
    parse: (body) => toDetail((body as { data: RawArtwork }).data),
  });
  protected readonly detail = computed(() =>
    this.record.hasValue() ? this.record.value() : null,
  );

  /** What's known now: the whole record, or what a list or Saved had. */
  protected readonly work = computed<Artwork | null>(() => {
    const id = Number(this.id());
    return (
      this.detail() ??
      this.#museum.known(id) ??
      this.saved.works().find((work) => work.id === id) ??
      null
    );
  });
  protected readonly isSaved = computed(() => {
    const work = this.work();
    return !!work && this.saved.works().some((saved) => saved.id === work.id);
  });

  /** The picture's proportions, within reason, so its pane fits it. */
  protected readonly ratio = computed(() => {
    const image = this.work()?.image;
    if (!image) return 1;
    return Math.min(1.7, Math.max(0.7, image.width / image.height));
  });

  /**
   * The facts the record has, in rows: two short ones share a row, a long
   * one takes a row to itself.
   */
  protected readonly facts = computed(() => {
    const work = this.work();
    if (!work) return [];
    const detail = this.detail();
    const facts: { label: string; value: string }[] = [];
    const add = (label: string, value: string | null | undefined) => {
      if (value) facts.push({ label, value });
    };
    add('Date', work.date);
    add('Type', work.type);
    add('Medium', work.technique);
    add('Culture', detail?.culture);
    add('Department', work.department);
    // The museum lists each measurement on a line (unframed, framed, …).
    add('Size', detail?.measurements?.split(/[;\n]/)[0]);
    add('Accession', work.accession);
    const short = (fact: { value: string }) => fact.value.length <= 20;
    const rows: (typeof facts)[] = [];
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i]!;
      const next = facts[i + 1];
      if (short(fact) && next && short(next)) {
        rows.push([fact, next]);
        i++;
      } else {
        rows.push([fact]);
      }
    }
    return rows;
  });

  /** The title shows in the top bar once the title pane has scrolled away. */
  protected readonly titleShown = signal(false);

  protected scrolled(event: LynxEvent<ScrollDetail>): void {
    const shown = event.detail.scrollTop > 420;
    if (shown !== this.titleShown()) this.titleShown.set(shown);
  }

  protected zoom(): void {
    void this.#router.navigate(['zoom'], { relativeTo: this.#route });
  }

  protected share(work: Artwork): void {
    const url = this.detail()?.url ?? undefined;
    const by = work.maker ? ` by ${work.maker}` : '';
    void this.#share
      .share({ title: work.title, text: `${work.title}${by}`, url })
      .catch(() => undefined);
  }

  protected visit(url: string): void {
    void this.#linking.openInApp(url).catch(() => undefined);
  }
}
