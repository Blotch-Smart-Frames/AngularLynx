import {
  Component,
  DestroyRef,
  ElementRef,
  Injectable,
  Injector,
  Renderer2,
  ViewEncapsulation,
  computed,
  inject,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxSystemInfo } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';

/**
 * A bar over the top of the screen, as the scroll view under it sees it: a
 * navigation bar, or a bar of your own.
 */
export type UiTopBar = {
  /** The bar's height below the status bar, in px. Content starts below it. */
  readonly height: Signal<number>;
  /**
   * A large title for the top of the content, which scrolls away with it
   * while the bar shows the title inline, or `null` for none.
   */
  readonly largeTitle: Signal<string | null>;
};

/** A bar over the bottom of the screen, such as a toolbar. */
export type UiBottomBar = {
  /** The bar's height above the home indicator, in px. */
  readonly height: Signal<number>;
};

/**
 * What the bars of a screen and the scroll view under them tell each other.
 * The bars say how much room they take, and the scroll view makes that room
 * at its ends and says where its content is: the frosted bar turns opaque
 * once content scrolls under it, and Material's changes color.
 *
 * A service, because neither can inject the other: the bars and the scroll
 * view are siblings in a screen's template. It's provided in the root, which
 * fits one screen at a time. When two screens with bars show at once, such
 * as a sheet with its own navigation bar over a screen with one, give each
 * its own by providing `UiBarState` on the component that holds it:
 *
 * ```ts
 * @Component({ providers: [UiBarState], … })
 * export class EditNoteSheet {}
 * ```
 */
@Injectable({ providedIn: 'root' })
export class UiBarState {
  readonly topBar = signal<UiTopBar | null>(null);
  readonly bottomBar = signal<UiBottomBar | null>(null);
  /** The scroll view under the bars (a `ui-bar-scroll`), while there's one. */
  readonly content = signal<object | null>(null);

  /** Whether content has scrolled under the top bar. */
  readonly scrolledUnderTop = signal(false);
  /**
   * Whether the large title has scrolled under the top bar, so the bar shows
   * the title instead.
   */
  readonly largeTitleUnder = signal(false);
  /** Whether content continues under the bottom bar. */
  readonly scrolledUnderBottom = signal(false);

  /**
   * Puts `value` in `slot` until `destroyRef`'s component goes, and returns
   * the callback's removal. It clears the slot only if it still holds
   * `value`: when the router swaps screens, the next screen's bar may
   * already be in it.
   */
  attach<T extends object>(
    slot: WritableSignal<T | null>,
    value: T,
    destroyRef: DestroyRef,
  ): () => void {
    slot.set(value);
    return destroyRef.onDestroy(() => {
      if (slot() === value) slot.set(null);
    });
  }
}

/**
 * How far content scrolls before the large title has passed under the bar,
 * which then shows the title instead, in px: past iOS's 34pt bold title in
 * its 52pt band, and Material 3 Expressive's 28sp title in the 48dp its
 * medium flexible app bar adds.
 */
const LARGE_TITLE_UNDER: Readonly<Record<GlassDesign, number>> = {
  glass: 44,
  frosted: 44,
  material: 40,
};

/**
 * How the scroll edge effect fades content under a glass bar: how much of it
 * shows (0 to 1) at fractions of the bar's space from the screen's edge.
 * None of it shows under the status bar, little under the bar's controls,
 * so they stay legible over whatever passes beneath them, and all of it from
 * the bar's inner edge, where content rests before it scrolls.
 */
const EDGE_FADE: readonly (readonly [at: number, alpha: number])[] = [
  [0, 0],
  [0.7, 0],
  [0.9, 0.12],
  [1, 1],
];

/** What Lynx sends with `scroll` and `layoutchange`, as far as this reads. */
type ScrollDetail = { scrollTop: number; scrollHeight: number };
type LayoutDetail = { height: number };

/**
 * The platform, as SystemInfo names it, or undefined where there's no
 * SystemInfo to read, such as in unit tests, where LynxSystemInfo throws.
 */
export const platformOf = (injector: Injector): string | undefined => {
  try {
    return injector.get(LynxSystemInfo).platform;
  } catch {
    return undefined;
  }
};

/**
 * A mask stop: content fully hidden (`0`) to fully shown (`1`) at `at`.
 */
const stop = (alpha: number, at: string): string =>
  `rgba(0, 0, 0, ${alpha}) ${at}`;

/**
 * Makes a `<scroll-view>` the content under a screen's bars
 * (`ui-navigation-bar` and `ui-toolbar`), as UIKit adjusts a scroll view for
 * the bars over it:
 *
 * ```html
 * <ui-navigation-bar title="Notes" largeTitle />
 * <scroll-view ui-bar-scroll scroll-orientation="vertical" class="h-full">
 *   …
 * </scroll-view>
 * ```
 *
 * - **Room for the bars:** the content starts below the top bar and the
 *   status bar, and ends above the bottom bar and the home indicator, so it
 *   scrolls beneath them but rests clear of them.
 * - **The large title** sits at the top of the content and scrolls away with
 *   it, and the bar shows the title once it has gone under.
 * - **The scroll edge effect:** under glass bars, content fades out as it
 *   passes under them, so their controls stay legible. It's a mask on the
 *   scroll view, so it fades to whatever is behind, the screen's background
 *   or an image.
 * - **Where the content is,** for the bars: the frosted bars before iOS 26
 *   turn opaque, and Material's top app bar changes color, once content
 *   scrolls under them.
 *
 * It listens to the scroll view's events itself, as `ui-dock-scroll` does,
 * so it updates the bars only when they should change, rather than running
 * change detection on every event.
 */
@Component({
  selector: 'scroll-view[ui-bar-scroll]',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: { '[style.mask-image]': 'edgeMask()' },
  // The spacers measure themselves, for the edge effect: their height counts
  // the safe area, which only CSS knows.
  template: `
    <view
      [style.height]="topInset()"
      (bindlayoutchange)="measureTop($event)"
    ></view>
    @if (largeTitle(); as title) {
      <view [class]="largeTitleClass()">
        <text accessibility-traits="header" [class]="largeTitleTextClass()">{{
          title
        }}</text>
      </view>
    }
    <ng-content />
    <view
      [style.height]="bottomInset()"
      (bindlayoutchange)="measureBottom($event)"
    ></view>
  `,
})
export class UiBarScroll {
  readonly #state = inject(UiBarState);
  readonly #renderer = inject(Renderer2);
  readonly #element = inject(ElementRef).nativeElement;
  readonly #design = injectGlassDesign();
  readonly #platform = platformOf(inject(Injector));

  /** The scroll view's own height and its spacers', from Lynx's layout. */
  protected readonly viewport = signal(0);
  protected readonly topSpace = signal(0);
  protected readonly bottomSpace = signal(0);

  /** The last scroll position and content height Lynx reported. */
  #scrollTop = 0;
  #scrollHeight = 0;

  protected readonly attachment = this.#state.attach(
    this.#state.content,
    this,
    inject(DestroyRef),
  );

  protected readonly listeners = [
    this.#renderer.listen(
      this.#element,
      'bindscroll',
      (event: { detail: ScrollDetail }) => this.#scrolled(event.detail),
    ),
    // iOS and Android report the content's height when it changes, which a
    // frosted toolbar needs before anything scrolls.
    this.#renderer.listen(
      this.#element,
      'bindcontentsizechanged',
      (event: { detail: ScrollDetail }) => this.#scrolled(event.detail),
    ),
    this.#renderer.listen(
      this.#element,
      'bindlayoutchange',
      (event: { detail: LayoutDetail }) => {
        this.viewport.set(event.detail.height);
        this.#update();
      },
    ),
  ];

  protected readonly cleanup = inject(DestroyRef).onDestroy(() => {
    for (const remove of this.listeners) remove();
    if (this.#state.content() === null) {
      this.#state.scrolledUnderTop.set(false);
      this.#state.largeTitleUnder.set(false);
      this.#state.scrolledUnderBottom.set(false);
    }
  });

  protected readonly largeTitle = computed(
    () => this.#state.topBar()?.largeTitle() ?? null,
  );

  protected readonly topInset = computed(() => {
    const bar = this.#state.topBar();
    return bar ? `calc(env(safe-area-inset-top) + ${bar.height()}px)` : null;
  });

  protected readonly bottomInset = computed(() => {
    const bar = this.#state.bottomBar();
    return bar ? `calc(env(safe-area-inset-bottom) + ${bar.height()}px)` : null;
  });

  protected readonly largeTitleClass = computed(() =>
    cn(
      'flex-col px-[16px] flex justify-end',
      this.#design() === 'material' ? 'h-[48px] pb-[4px]' : 'h-[52px] pb-[8px]',
    ),
  );

  protected readonly largeTitleTextClass = computed(() =>
    this.#design() === 'material'
      ? 'text-[28px] leading-[36px] text-foreground'
      : 'text-[34px] font-bold leading-[41px] text-foreground',
  );

  /**
   * The scroll edge effect: a mask that fades content out under glass bars,
   * from the spacers' measured heights. The other designs mark the edge with
   * the bar's own background instead, as their platforms do.
   *
   * Native Lynx reads only percentages as gradient stops, so there the stops
   * come from the scroll view's height too. The web preview's scroll view
   * reports no layout (web-elements' `<x-scroll-view>` sends no
   * `layoutchange`), but the browser reads lengths, so there the stops are
   * px from each end.
   */
  protected readonly edgeMask = computed(() => {
    const top = this.topSpace();
    const bottom = this.bottomSpace();
    const height = this.viewport();
    const web = this.#platform === 'web';
    if (
      this.#design() !== 'glass' ||
      top + bottom <= 0 ||
      (!web && height <= 0)
    ) {
      return null;
    }
    const percent = (px: number) =>
      `${Math.min(100, Math.max(0, (px / height) * 100)).toFixed(2)}%`;
    const length = (px: number) => `${Number(px.toFixed(2))}px`;
    const fromTop = (px: number) => (web ? length(px) : percent(px));
    const fromBottom = (px: number) =>
      web ? `calc(100% - ${length(px)})` : percent(height - px);
    // Top down to the content, then the bottom bar's fade the other way up.
    const stops = [
      ...(top > 0
        ? EDGE_FADE.map(([edge, alpha]) => stop(alpha, fromTop(top * edge)))
        : [stop(1, fromTop(0))]),
      ...(bottom > 0
        ? EDGE_FADE.map(([edge, alpha]) =>
            stop(alpha, fromBottom(bottom * edge)),
          ).reverse()
        : [stop(1, fromBottom(0))]),
    ];
    return `linear-gradient(to bottom, ${stops.join(', ')})`;
  });

  protected measureTop(event: Event): void {
    this.topSpace.set(
      (event as Event & { detail: LayoutDetail }).detail.height,
    );
  }

  protected measureBottom(event: Event): void {
    this.bottomSpace.set(
      (event as Event & { detail: LayoutDetail }).detail.height,
    );
  }

  #scrolled({ scrollTop, scrollHeight }: ScrollDetail): void {
    this.#scrollTop = scrollTop;
    this.#scrollHeight = scrollHeight;
    this.#update();
  }

  /**
   * Tells the bars where the content is. Signals ignore a value they already
   * hold, so the bars change only when content crosses an edge.
   */
  #update(): void {
    const state = this.#state;
    if (state.content() !== this) return;
    const top = this.#scrollTop;
    state.scrolledUnderTop.set(top > 0);
    state.largeTitleUnder.set(
      !!this.largeTitle() && top >= LARGE_TITLE_UNDER[this.#design()],
    );
    const viewport = this.viewport();
    state.scrolledUnderBottom.set(
      viewport > 0 && top + viewport < this.#scrollHeight - 1,
    );
  }
}
