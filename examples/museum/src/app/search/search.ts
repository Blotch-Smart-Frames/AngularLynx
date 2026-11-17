import { UpperCasePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LYNX_ELEMENTS,
  type LynxEvent,
  type LynxListItemAttributes,
  LynxTheme,
} from '@blotch/angular-lynx';
import { API, type Artwork, DEPARTMENTS, type RawPage } from '../data/artwork';
import { type Filters, Museum, PagedWorks } from '../data/museum';
import { BAY_HEIGHT, type Bay, BayView, hang } from '../wall/bay';
import { Press } from '../wall/press';
import { Daylight, Trouble } from '../wall/states';

type DepartmentPane = {
  readonly name: string;
  readonly grow: number;
  readonly whole: boolean;
};

/**
 * Lays the departments out as Search's rows (see `departmentRows`).
 */
const rowsOf = (names: readonly string[]): DepartmentPane[][] => {
  const rows: DepartmentPane[][] = [];
  let at = 0;
  for (let row = 0; at < names.length; row++) {
    if (row % 3 === 1 || at + 1 === names.length) {
      rows.push([{ name: names[at]!, grow: 1, whole: true }]);
      at += 1;
    } else {
      const [wide, narrow] = row % 3 === 0 ? [3, 2] : [2, 3];
      rows.push([
        { name: names[at]!, grow: wide, whole: false },
        { name: names[at + 1]!, grow: narrow, whole: false },
      ]);
      at += 2;
    }
  }
  return rows;
};

/** How long typing pauses before the search runs. */
const DEBOUNCE_MS = 350;

/**
 * A count with thousands separated, "41,231". Lynx has no `Intl` (the
 * build's `intl` option adds it, with locale data this app doesn't need).
 */
const count = {
  format: (n: number): string =>
    String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
};

/**
 * Search the whole open-access collection: by words, a department, or
 * both. With neither, the departments to browse. Results load a page at a
 * time as the wall scrolls, like On View's.
 */
@Component({
  selector: 'app-search',
  imports: [LYNX_ELEMENTS, UpperCasePipe, BayView, Daylight, Press, Trouble],
  host: { class: 'relative flex flex-1 flex-col bg-bar' },
  template: `
    <view class="flex flex-col gap-1.5 bg-bar px-1.5 pb-1.5">
      <view class="pt-status"></view>
      <view class="flex flex-row gap-1.5">
        <view class="pane flex flex-1 flex-col justify-end px-4 pt-4 pb-2.5">
          <text
            class="display text-[60px] leading-[54px]"
            accessibility-traits="header"
            >SEARCH</text
          >
        </view>
        <view
          class="pane-cobalt flex w-[92px] flex-col justify-end px-3 pb-2.5"
          accessibility-element="true"
          [attr.accessibility-label]="collectionLabel()"
        >
          @if (collectionSize(); as size) {
            <text class="display text-[24px] leading-[26px] text-on-color">{{
              size
            }}</text>
            <text class="label text-[11px] text-on-color">WORKS</text>
          }
        </view>
      </view>
      <view class="flex h-[52px] flex-row gap-1.5">
        <view class="pane flex flex-1 flex-row items-center px-4">
          <input
            class="h-full flex-1 text-[17px] text-ink"
            style="font-family: SofiaSans"
            confirm-type="search"
            accessibility-element="true"
            accessibility-traits="search"
            accessibility-label="Search the collection"
            [attr.placeholder]="
              query() ? null : 'Artist, title, place or material'
            "
            [attr.placeholder-color]="placeholderColor()"
            [style.-x-placeholder-color]="placeholderColor()"
            [value]="query()"
            (bindinput)="typed($event)"
            (bindconfirm)="run()"
          />
        </view>
        @if (query()) {
          <view
            appPress
            class="pane flex w-[76px] flex-col items-center justify-center"
            accessibility-element="true"
            accessibility-traits="button"
            accessibility-label="Clear the search"
            (bindtap)="clear()"
          >
            <text class="label text-ink">CLEAR</text>
          </view>
        }
      </view>
      @if (department(); as department) {
        <view
          appPress
          class="pane-cobalt flex h-[44px] flex-row items-center justify-between px-4"
          accessibility-element="true"
          accessibility-traits="button"
          [attr.accessibility-label]="
            'Searching ' + department + '. Tap to search every department.'
          "
          (bindtap)="choose(null)"
        >
          <text class="label text-ellipsis text-on-color" [text-maxline]="1">{{
            department | uppercase
          }}</text>
          <text class="label text-[11px] text-on-color">ALL DEPARTMENTS</text>
        </view>
      }
    </view>

    <list
      class="flex-1"
      list-type="single"
      scroll-orientation="vertical"
      [lower-threshold-item-count]="4"
      [preload-buffer-count]="2"
      style="list-main-axis-gap: 6px"
      (bindscrolltolower)="results.more()"
    >
      <list-item item-key="head">
        <view class="flex flex-col gap-1.5 px-1.5">
          @if (!searching()) {
            @for (row of departmentRows; track $index) {
              <view class="flex flex-row gap-1.5">
                @for (pane of row; track pane.name) {
                  <view
                    appPress
                    class="pane flex basis-0 flex-col justify-end px-3 pb-3"
                    [class.pane-seed]="!pane.whole"
                    [style.height.px]="pane.whole ? 104 : 84"
                    [style.flex-grow]="pane.grow"
                    accessibility-element="true"
                    accessibility-traits="button"
                    [attr.accessibility-label]="pane.name"
                    (bindtap)="choose(pane.name)"
                  >
                    <text
                      class="display text-ellipsis"
                      [style.font-size.px]="pane.whole ? 32 : 20"
                      [style.line-height.px]="pane.whole ? 32 : 21"
                      [text-maxline]="3"
                      >{{ pane.name | uppercase }}</text
                    >
                  </view>
                }
              </view>
            }
          } @else if (results.total() !== null) {
            <view class="pane pane-seed px-4 py-3">
              <text class="text-[15px] leading-[21px] text-ink-soft">{{
                summary()
              }}</text>
            </view>
          }
        </view>
      </list-item>

      <list-item
        *lynxListFor="let bay of bays(); trackBy: byKey; itemAttributes: layout"
      >
        <app-bay class="px-1.5" [bay]="bay" (opened)="open($event)" />
      </list-item>

      <list-item item-key="end">
        <view class="pb-tab-bar flex flex-col gap-1.5 px-1.5">
          @if (searching()) {
            @switch (results.status()) {
              @case ('loading') {
                <app-daylight [count]="results.works().length ? 1 : 3" />
              }
              @case ('error') {
                <app-trouble
                  [title]="
                    results.works().length
                      ? 'The next works failed to load.'
                      : 'The museum can\\'t be reached.'
                  "
                  detail="Check the connection and try again."
                  (pressed)="results.more()"
                />
              }
            }
          }
        </view>
      </list-item>
    </list>
  `,
})
export class Search {
  readonly #museum = inject(Museum);
  readonly #router = inject(Router);
  readonly #route = inject(ActivatedRoute);
  readonly #theme = inject(LynxTheme);

  /**
   * The departments as a run of the wall: two to a row in panes of unequal
   * width (3:2, then 2:3), with a whole row of clear glass every third, so
   * the list reads as a partition rather than a grid of equal tiles.
   */
  protected readonly departmentRows = rowsOf(DEPARTMENTS);
  protected readonly query = signal('');
  protected readonly department = signal<string | null>(null);
  protected readonly results = new PagedWorks(this.#museum);
  protected readonly searching = computed(() => this.#filters() !== null);

  /** The search as last run: what the results are for. */
  readonly #filters = signal<Filters | null>(null);

  /**
   * How many works the open collection has with pictures: one request with
   * `httpResource`, which Angular sends once the screen is created.
   */
  readonly #size = httpResource<RawPage>(() => ({
    url: API,
    params: { cc0: 1, has_image: 1, limit: 1, fields: 'id' },
  }));
  protected readonly collectionSize = computed(() =>
    this.#size.hasValue() ? count.format(this.#size.value().info.total) : null,
  );
  protected readonly collectionLabel = computed(() => {
    const size = this.collectionSize();
    return size ? `${size} works in the open collection` : 'Loading';
  });

  protected readonly placeholderColor = computed(() =>
    this.#theme.appearance() === 'dark'
      ? 'rgba(184, 182, 174, 1)'
      : 'rgba(112, 110, 102, 1)',
  );

  protected readonly bays = computed(() => hang(this.results.works()));
  protected readonly summary = computed(() => {
    const total = this.results.total() ?? 0;
    const filters = this.#filters();
    const words = typeof filters?.['q'] === 'string' ? filters['q'] : null;
    const where = this.department() ? ` in ${this.department()}` : '';
    const matching = words ? ` matching “${words}”` : '';
    if (total === 0) {
      return `Nothing in the open collection${where}${matching}. Try a name, a place or a material.`;
    }
    return `${count.format(total)} ${total === 1 ? 'work' : 'works'}${where}${matching}.`;
  });

  protected readonly byKey = (_: number, bay: Bay) => bay.key;
  protected readonly layout = (bay: Bay): LynxListItemAttributes => ({
    'reuse-identifier': bay.kind,
    'estimated-main-axis-size-px': BAY_HEIGHT[bay.kind],
  });

  #debounce: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.#debounce));
  }

  protected typed(event: LynxEvent<{ value: string }>): void {
    this.query.set(event.detail.value);
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => this.run(), DEBOUNCE_MS);
  }

  /**
   * Runs the search as it stands: the words typed and the department.
   */
  protected run(): void {
    clearTimeout(this.#debounce);
    const words = this.query().trim();
    const department = this.department();
    const filters: Filters | null =
      words || department
        ? {
            ...(words && { q: words }),
            ...(department && { department }),
          }
        : null;
    if (JSON.stringify(filters) === JSON.stringify(this.#filters())) return;
    this.#filters.set(filters);
    this.results.start(filters);
  }

  protected choose(department: string | null): void {
    this.department.set(department);
    this.run();
  }

  protected clear(): void {
    this.query.set('');
    this.run();
  }

  protected open(work: Artwork): void {
    void this.#router.navigate(['work', work.id], { relativeTo: this.#route });
  }
}
